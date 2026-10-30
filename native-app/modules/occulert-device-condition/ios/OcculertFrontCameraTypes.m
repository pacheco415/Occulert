#import "OcculertFrontCameraTypes.h"
#import <AVFoundation/AVFoundation.h>

@implementation OcculertFrontCameraTypes
+ (NSArray<NSString *> *)duoDeviceTypes {
#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 270100
  if (@available(iOS 27.1, *)) {
    return @[AVCaptureDeviceTypeBuiltInOuterUltraWideCamera, AVCaptureDeviceTypeBuiltInInnerUltraWideCamera];
  }
#endif
  return @[];
}

+ (NSString *)cameraRoleForDeviceType:(NSString *)deviceType {
#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 270100
  if (@available(iOS 27.1, *)) {
    if ([deviceType isEqualToString:AVCaptureDeviceTypeBuiltInOuterUltraWideCamera]) return @"outer";
    if ([deviceType isEqualToString:AVCaptureDeviceTypeBuiltInInnerUltraWideCamera]) return @"inner";
  }
#endif
  if ([deviceType isEqualToString:AVCaptureDeviceTypeBuiltInWideAngleCamera]
      || [deviceType isEqualToString:AVCaptureDeviceTypeBuiltInUltraWideCamera]
      || [deviceType isEqualToString:AVCaptureDeviceTypeBuiltInTelephotoCamera]
      || [deviceType isEqualToString:AVCaptureDeviceTypeBuiltInTrueDepthCamera]) return @"standard";
  return @"unknown";
}
@end
