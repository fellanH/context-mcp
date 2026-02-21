/** File System Access API — showDirectoryPicker (Chrome 86+) */
interface FileSystemDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
}

interface DirectoryPickerOptions {
  mode?: "read" | "readwrite";
  startIn?:
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
}

interface Window {
  showDirectoryPicker(
    options?: DirectoryPickerOptions,
  ): Promise<FileSystemDirectoryHandle>;
}
