Pod::Spec.new do |s|
  s.name           = 'OpenCVFeatures'
  s.version        = '0.1.0'
  s.summary        = 'ORB features and capture triage metrics for artlog (OpenCV, Expo module)'
  s.description    = 'Decodes crop files and runs OpenCV ORB detection and blur/glare metrics off the JS thread.'
  s.author         = 'artlog'
  s.homepage       = 'https://github.com/dwjiang/artlog-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Pinned: another OpenCV build can change ORB descriptors, which must match scripts/data/pipeline/orb.py.
  s.dependency 'FastOpenCV-iOS', '1.0.4'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = '**/*.{h,m,mm,swift}'
end
