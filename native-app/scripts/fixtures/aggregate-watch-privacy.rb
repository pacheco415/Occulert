# Exercise the installed RN implementation with real Xcodeproj project objects.
# No pod downloads, dependency compilation, signing, or provider access is used.
require 'json'
require 'stringio'
require 'xcodeproj'
require ARGV.fetch(1)

module Pod
  module UI
    def self.puts(*args); end
  end
end

project = Xcodeproj::Project.open(ARGV.fetch(0))
targets = PrivacyManifestUtils.get_application_targets(project)
aggregation_path = PrivacyManifestUtils.get_privacyinfo_file_path(project, targets).to_s
installer = Struct.new(:aggregate_targets, :pod_targets).new(
  [Struct.new(:user_project).new(project)], []
)
original_stdout = $stdout
begin
  $stdout = StringIO.new
  PrivacyManifestUtils.add_aggregated_privacy_manifest(installer)
  project.save
ensure
  $stdout = original_stdout
end
puts JSON.generate({ aggregationPath: aggregation_path, applicationTargets: targets.map(&:name),
                     xcodeprojVersion: Xcodeproj::VERSION })
