function createFileSystemMock() {
  const files = new Map();
  const directories = new Set(['file:///docs', 'file:///cache']);
  const uriFor = (parts) => parts.map((part, index) => {
    const value = typeof part === 'string' ? part : part.uri;
    return index === 0 ? value.replace(/\/$/, '') : value.replace(/^\/+|\/+$/g, '');
  }).join('/');

  class Directory {
    constructor(...parts) { this.uri = uriFor(parts); }
    get exists() { return directories.has(this.uri); }
    create() {
      let current = this.uri;
      while (current.startsWith('file:///') && !directories.has(current)) {
        directories.add(current);
        current = current.slice(0, current.lastIndexOf('/'));
      }
    }
    delete() {
      for (const uri of files.keys()) {
        if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
      }
      for (const uri of directories) {
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) directories.delete(uri);
      }
    }
  }

  class File {
    constructor(...parts) { this.uri = uriFor(parts); }
    get exists() { return files.has(this.uri); }
    async arrayBuffer() {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error(`missing file: ${this.uri}`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    write(bytes) { files.set(this.uri, new Uint8Array(bytes)); }
    delete() { files.delete(this.uri); }
  }

  return {
    Directory, File,
    Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } },
    files, directories,
  };
}

module.exports = { createFileSystemMock };
