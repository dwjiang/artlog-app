Pod::Spec.new do |s|
  s.name           = 'DemoCamera'
  s.version        = '0.1.0'
  s.summary        = 'A video stand-in for the camera in the judges demo build of artlog (Expo module)'
  s.description    = 'Plays a looping video where the camera preview goes and runs the vision-rect rectangle detector on its frames.'
  s.author         = 'artlog'
  s.homepage       = 'https://github.com/dwjiang/artlog-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['AVFoundation', 'CoreImage', 'Vision']

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  # RectangleDetector.swift links to vision-rect's copy: vision-rect is a Nitro module built with C++ interop, which
  # an Expo module cannot import, so both compile the same source.
  s.source_files = '**/*.{h,m,mm,swift}'
end
