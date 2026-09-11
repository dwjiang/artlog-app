require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "VisionRect"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/dwjiang/artlog-app"
  s.license      = "UNLICENSED"
  s.authors      = "artlog"

  s.platforms    = { :ios => '17.0' }
  s.source       = { :git => "https://github.com/dwjiang/artlog-app.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
  ]
  s.frameworks = ["Vision", "CoreImage", "ImageIO"]

  load 'nitrogen/generated/ios/VisionRect+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  s.dependency 'VisionCamera'
  install_modules_dependencies(s)
end
