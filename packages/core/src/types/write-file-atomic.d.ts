declare module 'write-file-atomic' {
  interface Options {
    encoding?: BufferEncoding
    mode?: number
    chown?: { uid: number; gid: number }
    fsync?: boolean
  }
  function writeFileAtomic(path: string, data: string | Buffer, options?: Options): Promise<void>
  export default writeFileAtomic
}
