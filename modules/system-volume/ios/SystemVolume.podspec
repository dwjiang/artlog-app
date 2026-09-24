Pod::Spec.new do |s|
  s.name           = 'SystemVolume'
  s.version        = '0.1.0'
  s.summary        = 'The iPhone media volume as a slider for the artlog player (Expo module)'
  s.description    = 'Wraps MPVolumeView so the Now Playing volume bar shows and sets the system volume.'
  s.author         = 'artlog'
  s.homepage       = 'https://github.com/dwjiang/artlog-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['MediaPlayer']

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = '**/*.{h,m,mm,swift}'
end
