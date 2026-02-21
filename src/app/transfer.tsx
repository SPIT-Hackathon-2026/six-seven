import { View, Button, Alert, ScrollView } from "react-native";
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import JSZip from 'jszip';

export default function Transfer() {

  const baseDir = FileSystem.documentDirectory!;
const repoPath = baseDir + "myrepo/";
const zipPath = baseDir + "myrepo.zip";

  // 📤 SEND REPO
  const handleSendRepo = async () => {
    try {
      const zip = new JSZip();

      const addFolderToZip = async (folderPath: string, parent = "") => {
        const files = await FileSystem.readDirectoryAsync(folderPath);

        for (let file of files) {
          const fullPath = folderPath + file;
          const fileInfo = await FileSystem.getInfoAsync(fullPath);

          if (fileInfo.isDirectory) {
            await addFolderToZip(fullPath + "/", parent + file + "/");
          } else {
            const content = await FileSystem.readAsStringAsync(fullPath, {
              encoding: 'base64',
            });
            zip.file(parent + file, content, { base64: true });
          }
        }
      };

      await addFolderToZip(repoPath);

      const zipped = await zip.generateAsync({ type: "base64" });

      await FileSystem.writeAsStringAsync(zipPath, zipped, {
        encoding: 'base64',
      });

      await Sharing.shareAsync(zipPath);

    } catch (error: any) {
      Alert.alert("Error Sending Repo", error.message);
    }
  };

  // 📥 IMPORT REPO
  const handleImportRepo = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync();

      if (!result.canceled && result.assets) {
        const uri = result.assets[0].uri;
        const zipData = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64',
        });

        const zip = await JSZip.loadAsync(zipData, { base64: true });

        for (const fileName of Object.keys(zip.files)) {
          const file = zip.files[fileName];

          if (!file.dir) {
            const content = await file.async("base64");
            const destPath = repoPath + fileName;

            const folder = destPath.substring(0, destPath.lastIndexOf("/"));
            await FileSystem.makeDirectoryAsync(folder, { intermediates: true });

            await FileSystem.writeAsStringAsync(destPath, content, {
              encoding: 'base64',
            });
          }
        }

        Alert.alert("Success", "Repository Imported Successfully!");
      }

    } catch (error: any) {
      Alert.alert("Error Importing Repo", error.message);
    }
  };

  return (
    <ScrollView style={{ padding: 20 }}>
      <Button title="Send Repo via Bluetooth" onPress={handleSendRepo} />
      <View style={{ height: 20 }} />
      <Button title="Import Repo" onPress={handleImportRepo} />
    </ScrollView>
  );
}
