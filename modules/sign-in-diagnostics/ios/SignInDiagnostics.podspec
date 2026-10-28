Pod::Spec.new do |s|
  s.name = 'SignInDiagnostics'
  s.version = '0.1.0'
  s.summary = 'Read-only sign-in presentation diagnostics for Artlog'
  s.description = 'Returns bounded UIKit state without view content or account data.'
  s.author = 'artlog'
  s.homepage = 'https://github.com/dwjiang/artlog-app'
  s.license = 'UNLICENSED'
  s.platforms = { :ios => '17.0' }
  s.source = { git: 'https://github.com/dwjiang/artlog-app.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
