Pod::Spec.new do |s|
  s.name           = 'CoremlEmbed'
  s.version        = '0.1.0'
  s.summary        = 'On-device C-RADIOv3-B embedding for artlog (CoreML, Expo module)'
  s.description    = 'Loads the compiled C-RADIOv3-B package fetched by `git lfs pull` and embeds letterboxed crops on the Neural Engine.'
  s.author         = 'artlog'
  s.homepage       = 'https://github.com/dwjiang/artlog-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['CoreML', 'ImageIO']

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = '**/*.{h,m,mm,swift}'
  # Precompiled by `xcrun coremlcompiler`; Xcode does not compile CocoaPods resources.
  s.resources = ['Models/*.mlmodelc', 'Models/model-manifest.json']
end
