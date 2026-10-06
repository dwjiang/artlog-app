Pod::Spec.new do |s|
  s.name           = 'SafeAreaBand'
  s.version        = '0.1.0'
  s.summary        = 'A top band that extends its screen safe area for artlog (Expo module)'
  s.description    = 'Adds the height of a band drawn under the status bar to its view controller safe area, so native headers start below it.'
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
