Pod::Spec.new do |s|
  s.name           = 'BackButtonTint'
  s.version        = '0.1.0'
  s.summary        = 'Tints the iOS 26 glass back chevron for artlog (Expo module)'
  s.description    = 'Gives each react-native-screens screen a tinted back item, the only tint iOS 26 honors for the back button.'
  s.author         = 'artlog'
  s.homepage       = 'https://github.com/dwjiang/artlog-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = '**/*.{h,m,mm,swift}'
end
