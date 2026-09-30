Pod::Spec.new do |s|
  s.name           = 'AudioSeeking'
  s.version        = '1.0.0'
  s.summary        = 'Native seekable duration for Artlog narration'
  s.description    = 'Reads the AVPlayer seekable range through the Expo Audio shared reference.'
  s.author         = 'artlog'
  s.homepage       = 'https://github.com/dwjiang/artlog-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['AVFoundation']

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
