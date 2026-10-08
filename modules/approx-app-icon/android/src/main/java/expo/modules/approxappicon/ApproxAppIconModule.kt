package expo.modules.approxappicon

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "ApproxAppIcon"

/**
 * Launcher aliases written by the config plugin (modules/approx-app-icon/app.plugin.js),
 * keyed by theme. Both target MainActivity; the light one is enabled in the manifest.
 */
private val ALIAS_SUFFIXES = linkedMapOf(
  "light" to ".MainActivityLight",
  "dark" to ".MainActivityDark",
)

class ApproxAppIconModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ApproxAppIcon")

    OnCreate {
      application?.let { IconSwitcher.install(it) }
    }

    AsyncFunction("setIcon") { name: String ->
      val app = application ?: return@AsyncFunction false
      IconSwitcher.request(app, name)
    }

    AsyncFunction("getIcon") {
      val app = application ?: return@AsyncFunction "light"
      IconSwitcher.current(app)
    }
  }

  private val application: Application?
    get() = appContext.reactContext?.applicationContext as? Application
}

/**
 * Holds a requested icon until the app is out of sight, then swaps the aliases.
 *
 * Swapping waits for every activity of the app to stop. Stopping — not pausing:
 * a permission dialog or the notification shade pauses the app without stopping
 * it, and the icon must never change under a user who is still looking at it.
 * MainActivity itself is never enabled or disabled, and nothing is killed, so
 * the screen the user comes back to is the one they left.
 */
internal object IconSwitcher : Application.ActivityLifecycleCallbacks {
  @Volatile private var pending: String? = null
  private var installed = false
  private var startedActivities = 0

  @Synchronized
  fun install(application: Application) {
    if (installed) return
    installed = true
    application.registerActivityLifecycleCallbacks(this)
  }

  /** Records `name` as the wanted icon. False if this build has no such alias. */
  fun request(context: Context, name: String): Boolean {
    if (resolveAliases(context)[name] == null) return false
    pending = if (current(context) == name) null else name
    return true
  }

  /** "dark" when the dark alias is the enabled launcher entry, otherwise "light". */
  fun current(context: Context): String {
    val dark = resolveAliases(context)["dark"] ?: return "light"
    val state = context.packageManager.getComponentEnabledSetting(ComponentName(context.packageName, dark))
    return if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) "dark" else "light"
  }

  private fun applyPending(context: Context) {
    val name = pending ?: return
    pending = null
    val aliases = resolveAliases(context)
    val target = aliases[name] ?: return
    val pm = context.packageManager
    val pkg = context.packageName
    try {
      // Enable first, so the app is never left without a launcher entry.
      pm.setComponentEnabledSetting(
        ComponentName(pkg, target),
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP,
      )
      for ((other, alias) in aliases) {
        if (other == name) continue
        pm.setComponentEnabledSetting(
          ComponentName(pkg, alias),
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
          PackageManager.DONT_KILL_APP,
        )
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not switch the app icon to $name", e)
    }
  }

  /**
   * Theme name to the alias's fully qualified class name, read from the
   * installed package rather than assumed: the class name follows the manifest
   * namespace, which need not equal the application id.
   */
  private fun resolveAliases(context: Context): Map<String, String> {
    val activities = try {
      val flags = PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageInfo(
          context.packageName,
          PackageManager.PackageInfoFlags.of(flags.toLong()),
        ).activities
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, flags).activities
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not read the launcher aliases", e)
      null
    } ?: return emptyMap()

    val result = LinkedHashMap<String, String>()
    for ((name, suffix) in ALIAS_SUFFIXES) {
      val info = activities.firstOrNull { it.targetActivity != null && it.name.endsWith(suffix) }
      if (info != null) result[name] = info.name
    }
    // Both or neither: a build with only one alias cannot switch safely.
    return if (result.size == ALIAS_SUFFIXES.size) result else emptyMap()
  }

  override fun onActivityStarted(activity: Activity) {
    startedActivities += 1
  }

  override fun onActivityStopped(activity: Activity) {
    // Registered after MainActivity may already have started, so the count can
    // be one short; clamping keeps "nothing started" meaning "app left".
    startedActivities = maxOf(0, startedActivities - 1)
    if (startedActivities == 0 && !activity.isChangingConfigurations) {
      applyPending(activity.applicationContext)
    }
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
  override fun onActivityResumed(activity: Activity) = Unit
  override fun onActivityPaused(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) = Unit
}
