#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
// Keep new AVFoundation constants behind an SDK compile guard in Objective-C.
// Swift runtime availability alone cannot compile symbols absent from an SDK.
@interface OcculertFrontCameraTypes : NSObject
+ (NSArray<NSString *> *)duoDeviceTypes NS_SWIFT_NAME(duoDeviceTypes());
+ (NSString *)cameraRoleForDeviceType:(NSString *)deviceType NS_SWIFT_NAME(cameraRole(forDeviceType:));
@end
NS_ASSUME_NONNULL_END
