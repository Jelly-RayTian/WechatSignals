import Foundation
import Security
let service = "local.wechat-signals.typesafe"
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "api-key"]
func fail() -> Never { FileHandle.standardError.write(Data("Keychain operation failed".utf8)); exit(1) }
switch CommandLine.arguments.dropFirst().first {
case "get":
 var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
 var value: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &value)
 if status == errSecItemNotFound { exit(0) }
 guard status == errSecSuccess, let data = value as? Data else { fail() }
 FileHandle.standardOutput.write(data)
case "set":
 let data = FileHandle.standardInput.readDataToEndOfFile()
 guard !data.isEmpty && data.count < 8192 else { fail() }
 let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
 if status == errSecItemNotFound { var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly; guard SecItemAdd(q as CFDictionary,nil) == errSecSuccess else { fail() } }
 else if status != errSecSuccess { fail() }
case "delete":
 let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { fail() }
default: fail()
}
