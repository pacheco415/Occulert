require 'xcodeproj'

# A separate UI runner uses the already-built app by bundle ID. It has no app
# target or dependency and therefore cannot rebuild or alter the pinned binary.
root = File.dirname(__FILE__)
project = Xcodeproj::Project.new(File.join(root, 'TraceProof.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'TraceProof', :ios, '16.4')
target.source_build_phase.add_file_reference(project.main_group.new_file('SimulatorTraceProof.swift'))
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.occulert.simulator-trace.proof',
    'GENERATE_INFOPLIST_FILE' => 'YES', 'SWIFT_VERSION' => '5.0',
    'CODE_SIGNING_ALLOWED' => 'NO', 'SDKROOT' => 'iphonesimulator',
    'SUPPORTED_PLATFORMS' => 'iphonesimulator', 'TARGETED_DEVICE_FAMILY' => '1,2',
    'ONLY_ACTIVE_ARCH' => 'YES'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(project.path, 'TraceProof', true)
