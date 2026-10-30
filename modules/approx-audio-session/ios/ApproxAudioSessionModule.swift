import AVFoundation
import ExpoModulesCore

public class ApproxAudioSessionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ApproxAudioSession")

    /// Whether another app — Apple Music, Spotify, a podcast — is playing
    /// right now. Read at the moment zone music would start, so a friend's
    /// track never talks over the listener's own.
    Function("isOtherAudioPlaying") { () -> Bool in
      AVAudioSession.sharedInstance().isOtherAudioPlaying
    }
  }
}
