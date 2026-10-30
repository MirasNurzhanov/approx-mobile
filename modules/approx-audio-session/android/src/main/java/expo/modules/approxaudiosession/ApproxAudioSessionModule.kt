package expo.modules.approxaudiosession

import android.content.Context
import android.media.AudioManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ApproxAudioSessionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ApproxAudioSession")

    // Whether music is playing — Android's nearest equivalent of iOS's "is
    // another app playing". Read before zone music starts, so it is never ours.
    Function("isOtherAudioPlaying") {
      val context = appContext.reactContext ?: return@Function false
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audio?.isMusicActive ?: false
    }
  }
}
