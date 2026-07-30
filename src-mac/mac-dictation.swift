import Foundation
import Speech

func emit(_ type: String, _ text: String = "", _ error: String = "") {
    var dict: [String: String] = ["type": type]
    if !text.isEmpty { dict["text"] = text }
    if !error.isEmpty { dict["error"] = error }
    
    if let jsonData = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
        fflush(stdout)
    }
}

guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
    SFSpeechRecognizer.requestAuthorization { status in
        if status == .authorized {
            startRecording()
        } else {
            emit("error", "", "Authorization denied")
            exit(1)
        }
    }
    dispatchMain()
}

startRecording()
dispatchMain()

func startRecording() {
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))!
    let audioEngine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true

    let node = audioEngine.inputNode
    let recordingFormat = node.outputFormat(forBus: 0)
    
    node.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
        request.append(buffer)
    }
    
    audioEngine.prepare()
    do {
        try audioEngine.start()
        emit("start")
    } catch {
        emit("error", "", "Audio engine start failed: \(error)")
        exit(1)
    }
    
    recognizer.recognitionTask(with: request) { result, error in
        if let result = result {
            let text = result.bestTranscription.formattedString
            if result.isFinal {
                emit("final", text)
                exit(0)
            } else {
                emit("interim", text)
            }
        }
        if let error = error {
            emit("error", "", "Recognition error: \(error)")
            exit(1)
        }
    }
}
