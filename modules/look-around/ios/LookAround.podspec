Pod::Spec.new do |s|
  s.name           = 'LookAround'
  s.version        = '0.1.0'
  s.summary        = 'On-device Apple Look Around snapshots and viewer for artlog museums (Expo module)'
  s.description    = 'Renders a still of the Look Around scene nearest a coordinate and opens the interactive viewer; no API key and no images sent to artlog servers.'
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
