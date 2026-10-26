#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// OpenCV work on an image file converted to gray.
@interface OpenCVExtractor : NSObject

/// `width`, `height`, `keypoints` (float32 `[x, y, size, angle]` rows) and `descriptors` (32-byte rows).
+ (nullable NSDictionary<NSString *, id> *)orbAtPath:(NSString *)path
                                         maxKeypoints:(NSInteger)maxKeypoints
                                                error:(NSError **)error;

/// `blurVariance` and `glareFraction` of the image downscaled to `size`×`size`.
+ (nullable NSDictionary<NSString *, NSNumber *> *)triageAtPath:(NSString *)path
                                                            size:(NSInteger)size
                                                      glareLevel:(NSInteger)glareLevel
                                                           error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
