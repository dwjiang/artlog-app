import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let controller = UIViewController()
        controller.view.backgroundColor = .white
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor, constant: -20)
        ])
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = controller
        window?.makeKeyAndVisible()
        Task { await probe(stack: stack) }
        return true
    }

    @MainActor
    func probe(stack: UIStackView) async {
        let source = Bundle.main.url(forResource: "thumbnails", withExtension: "json")!
        let input = try! JSONSerialization.jsonObject(with: Data(contentsOf: source)) as! [String: Any]
        let images = input["images"] as! [[String: Any]]
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.timeoutIntervalForResource = 45
        let session = URLSession(configuration: config)
        var results: [[String: Any]] = []
        for item in images {
            let name = item["name"] as! String
            let url = URL(string: item["url"] as! String)!
            let label = UILabel()
            label.textColor = .black
            label.numberOfLines = 0
            label.font = .systemFont(ofSize: 15)
            label.text = "\(name): loading"
            stack.addArrangedSubview(label)
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
            let userAgent = "artlog/0.1 (iOS thumbnail probe; +https://github.com/dwjiang/artlog-app)"
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue("image/*", forHTTPHeaderField: "Accept")
            var result: [String: Any] = ["name": name, "url": url.absoluteString, "checked_at": ISO8601DateFormatter().string(from: Date()), "user_agent": userAgent, "referer": NSNull()]
            do {
                let (data, response) = try await session.data(for: request)
                let http = response as! HTTPURLResponse
                let image = UIImage(data: data)
                result["status"] = http.statusCode
                result["final_url"] = http.url!.absoluteString
                result["content_type"] = http.mimeType ?? "unknown"
                result["bytes"] = data.count
                result["decoded_image"] = image != nil
                label.text = "\(name): HTTP \(http.statusCode), image \(image == nil ? "failed" : "decoded")"
                if let image {
                    result["width"] = image.size.width
                    result["height"] = image.size.height
                    let view = UIImageView(image: image)
                    view.contentMode = .scaleAspectFit
                    view.heightAnchor.constraint(equalToConstant: 150).isActive = true
                    stack.addArrangedSubview(view)
                }
            } catch {
                result["error"] = error.localizedDescription
                label.text = "\(name): \(error.localizedDescription)"
            }
            results.append(result)
            try? await Task.sleep(for: .seconds(1.1))
        }
        let output: [String: Any] = ["environment": "iOS Simulator", "ios_version": UIDevice.current.systemVersion, "appearance": "light", "network": "URLSession ephemeral; no Referer; sequential GET; no retry", "images": results]
        let destination = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ios-thumbnails.json")
        try! JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]).write(to: destination)
    }
}
