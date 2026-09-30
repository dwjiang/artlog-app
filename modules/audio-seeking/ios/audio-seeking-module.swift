import AVFoundation
import ExpoModulesCore

public class AudioSeekingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioSeeking")

    Function("seekableDuration") { (player: SharedRef<AVPlayer>) -> Double in
      // Narration uses EVENT playlists: one continuous range starting at zero.
      guard let range = player.ref.currentItem?.seekableTimeRanges.first?.timeRangeValue,
        range.start == .zero else { return 0 }
      let end = CMTimeRangeGetEnd(range).seconds
      return end.isFinite ? max(0, end) : 0
    }
  }
}
