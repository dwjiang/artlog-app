Pod::Spec.new do |s|
  s.name           = 'PoiSearch'
  s.version        = '0.1.0'
  s.summary        = 'On-device MapKit point-of-interest search for artlog venue resolution (Expo module)'
  s.description    = 'Finds museums and galleries near a coordinate with MKLocalSearch; no API key and no coordinates sent to artlog servers.'
  s.author         = 'artlog'
  s.homepage       = 'https://github.com/dwjiang/artlog-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['MapKit', 'CoreLocation']

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = '**/*.{h,m,mm,swift}'
end
