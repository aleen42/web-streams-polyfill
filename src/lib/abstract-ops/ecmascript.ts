/* global structuredClone */

declare global {
  function structuredClone<T>(value: T, options: { transfer: ArrayBuffer[] }): T;
}

export function CreateArrayFromList<T extends any[]>(elements: T): T {
  // We use arrays to represent lists, so this is basically a no-op.
  // Do a slice though just in case we happen to depend on the unique-ness.
  return elements.slice() as T;
}

export function CopyDataBlockBytes(dest: ArrayBuffer,
                                   destOffset: number,
                                   src: ArrayBuffer,
                                   srcOffset: number,
                                   n: number) {
  new Uint8Array(dest).set(new Uint8Array(src, srcOffset, n), destOffset);
}

export let TransferArrayBuffer = <T extends ArrayBufferLike>(O: T): T => {
  if (typeof structuredClone === 'function') {
    TransferArrayBuffer = buffer => structuredClone(buffer, { transfer: [buffer] });
  } else {
    // Not implemented correctly
    TransferArrayBuffer = buffer => buffer;
  }
  return TransferArrayBuffer(O);
};

// Not implemented correctly
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CanTransferArrayBuffer(O: ArrayBufferLike): boolean {
  return !IsDetachedBuffer(O);
}

// Not implemented correctly
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function IsDetachedBuffer(O: ArrayBufferLike): boolean {
  return O.byteLength === 0;
}

export function ArrayBufferSlice(buffer: ArrayBufferLike, begin: number, end: number): ArrayBufferLike {
  // ArrayBuffer.prototype.slice is not available on IE10
  // https://www.caniuse.com/mdn-javascript_builtins_arraybuffer_slice
  if (buffer.slice) {
    return buffer.slice(begin, end);
  }
  const length = end - begin;
  const slice = new ArrayBuffer(length);
  CopyDataBlockBytes(slice, 0, buffer, begin, length);
  return slice;
}
