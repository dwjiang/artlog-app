#include <opencv2/core.hpp>
#include <opencv2/features2d.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#import "opencv-extractor.h"

template <typename Result, typename Body>
static Result run(NSError **error, Body body) {
  try {
    return body();
  } catch (const std::exception &exception) {
    if (error) {
      *error = [NSError errorWithDomain:@"OpenCVFeatures"
                                   code:0
                               userInfo:@{NSLocalizedDescriptionKey: @(exception.what())}];
    }
    return nil;
  }
}

/// Converts from color like orb.py's PIL `convert("L")`; `IMREAD_GRAYSCALE` would take libjpeg's luma for JPEGs instead.
static cv::Mat readGray(NSString *path) {
  cv::Mat image = cv::imread(path.fileSystemRepresentation, cv::IMREAD_COLOR);
  if (image.empty()) {
    throw std::runtime_error("Cannot decode the image file");
  }
  cv::Mat gray;
  cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
  return gray;
}

@implementation OpenCVExtractor

+ (nullable NSDictionary<NSString *, id> *)orbAtPath:(NSString *)path
                                         maxKeypoints:(NSInteger)maxKeypoints
                                                error:(NSError **)error {
  return run<NSDictionary<NSString *, id> *>(error, [&] {
    cv::Mat gray = readGray(path);
    std::vector<cv::KeyPoint> keypoints;
    cv::Mat descriptors;
    cv::ORB::create((int)maxKeypoints)->detectAndCompute(gray, cv::noArray(), keypoints, descriptors);
    std::vector<float> packed;
    packed.reserve(keypoints.size() * 4);
    for (const cv::KeyPoint &keypoint : keypoints) {
      packed.insert(packed.end(), {keypoint.pt.x, keypoint.pt.y, keypoint.size, keypoint.angle});
    }
    return @{
      @"width": @(gray.cols),
      @"height": @(gray.rows),
      @"keypoints": [NSData dataWithBytes:packed.data() length:packed.size() * sizeof(float)],
      @"descriptors": [NSData dataWithBytes:descriptors.data length:descriptors.total() * descriptors.elemSize()],
    };
  });
}

+ (nullable NSDictionary<NSString *, NSNumber *> *)triageAtPath:(NSString *)path
                                                            size:(NSInteger)size
                                                      glareLevel:(NSInteger)glareLevel
                                                           error:(NSError **)error {
  return run<NSDictionary<NSString *, NSNumber *> *>(error, [&] {
    cv::Mat small;
    cv::resize(readGray(path), small, cv::Size((int)size, (int)size), 0, 0, cv::INTER_AREA);
    cv::Mat laplacian;
    cv::Laplacian(small, laplacian, CV_64F);
    cv::Scalar mean, stddev;
    cv::meanStdDev(laplacian, mean, stddev);
    double highlights = cv::countNonZero(small >= glareLevel);
    return @{
      @"blurVariance": @(stddev[0] * stddev[0]),
      @"glareFraction": @(highlights / small.total()),
    };
  });
}

@end
