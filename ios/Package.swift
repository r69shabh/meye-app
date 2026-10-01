// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "MeyeCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "MeyeCore", targets: ["MeyeCore"])],
    targets: [
        .target(name: "MeyeCore", path: "Meye/Core"),
        .testTarget(name: "MeyeCoreTests", dependencies: ["MeyeCore"], path: "Tests/MeyeCoreTests")
    ]
)
