import Foundation
import Speech

let args = CommandLine.arguments

guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
    SFSpeechRecognizer.requestAuthorization { status in
        if status == .authorized {
            startRecording()
        } else {
            print("ERROR: Authorization denied")
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

    let node = audioEngine.inputNode
    let recordingFormat = node.outputFormat(forBus: 0)
    
    node.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
        request.append(buffer)
    }
    
    audioEngine.prepare()
    do {
        try audioEngine.start()
        print("READY")
        fflush(stdout)
    } catch {
        print("ERROR: \(error)")
        exit(1)
    }
    
    recognizer.recognitionTask(with: request) { result, error in
        if let result = result {
            let text = result.bestTranscription.formattedString
            print("TRANSCRIPT: \(text)")
            fflush(stdout)
        }
        if error != nil {
            print("ERROR: Recognition ended")
            exit(1)
        }
    }
}
