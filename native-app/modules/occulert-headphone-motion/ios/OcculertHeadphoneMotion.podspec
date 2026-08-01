require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'OcculertHeadphoneMotion'
  s.version          = package['version']
  s.summary          = package['description']
  s.description      = package['description']
  s.license          = { :type => 'Proprietary' }
  s.author           = 'Occulert'
  s.homepage         = 'https://occulert.com'
  s.platforms        = { :ios => '16.4' }
  s.swift_version    = '5.9'
  s.source           = { :git => 'https://github.com/pacheco415/Occulert.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreMotion'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
