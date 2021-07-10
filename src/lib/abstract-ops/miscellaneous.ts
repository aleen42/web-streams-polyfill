import NumberIsNaN from '../../stub/number-isnan';

export function IsNonNegativeNumber(v: number): boolean {
  if (typeof v !== 'number') {
    return false;
  }

  if (NumberIsNaN(v)) {
    return false;
  }

  if (v < 0) {
    return false;
  }

  return true;
}

export function CloneAsUint8Array(O: ArrayBufferView): Uint8Array {
  const buffer = O.buffer.slice(O.byteOffset, O.byteOffset + O.byteLength);
  return new Uint8Array(buffer);
}
