import assert from '../stub/assert';
import { MakeSizeAlgorithmFromSizeFunction, ValidateAndNormalizeHighWaterMark } from './helpers';
import {
  promiseRejectedWith,
  promiseResolvedWith,
  setPromiseIsHandledToTrue,
  transformPromiseWith
} from './helpers/webidl';
import { QueuingStrategy, QueuingStrategySizeCallback } from './queuing-strategy';
import { AcquireReadableStreamAsyncIterator, ReadableStreamAsyncIterator } from './readable-stream/async-iterator';
import {
  defaultReaderClosedPromiseReject,
  defaultReaderClosedPromiseResolve,
  ReadableStreamCreateReadResult,
  ReadResult
} from './readable-stream/generic-reader';
import {
  AcquireReadableStreamDefaultReader,
  IsReadableStreamDefaultReader,
  ReadableStreamDefaultReader
} from './readable-stream/default-reader';
import { ReadableStreamPipeTo } from './readable-stream/pipe';
import { ReadableStreamTee } from './readable-stream/tee';
import { IsWritableStream, IsWritableStreamLocked, WritableStream } from './writable-stream';
import NumberIsInteger from '../stub/number-isinteger';
import { SimpleQueue } from './simple-queue';
import {
  AcquireReadableStreamBYOBReader,
  IsReadableStreamBYOBReader,
  ReadableStreamBYOBReader
} from './readable-stream/byob-reader';
import {
  ReadableByteStreamController,
  ReadableStreamBYOBRequest,
  SetUpReadableByteStreamController,
  SetUpReadableByteStreamControllerFromUnderlyingSource
} from './readable-stream/byte-stream-controller';
import {
  ReadableStreamDefaultController,
  SetUpReadableStreamDefaultController,
  SetUpReadableStreamDefaultControllerFromUnderlyingSource
} from './readable-stream/default-controller';
import {
  ReadableByteStreamControllerCallback,
  ReadableStreamDefaultControllerCallback,
  ReadableStreamErrorCallback,
  UnderlyingByteSource,
  UnderlyingSource
} from './readable-stream/underlying-source';
import { noop } from '../utils';
import { AbortSignal, isAbortSignal } from './abort-signal';
import { typeIsObject } from './helpers/miscellaneous';
import { CreateArrayFromList } from './abstract-ops/ecmascript';
import { CancelSteps } from './abstract-ops/internal-methods';
import { IsNonNegativeNumber } from './abstract-ops/miscellaneous';
import { assertDictionary, isDictionary } from './validators/basic';

export type ReadableByteStream = ReadableStream<Uint8Array>;

export interface ReadableWritablePair<R, W> {
  readable: ReadableStream<R>;
  writable: WritableStream<W>;
}

export interface PipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  preventClose?: boolean;
  signal?: AbortSignal;
}

type ReadableStreamState = 'readable' | 'closed' | 'errored';

export class ReadableStream<R = any> {
  /** @internal */
  _state!: ReadableStreamState;
  /** @internal */
  _reader: ReadableStreamReader<R> | undefined;
  /** @internal */
  _storedError: any;
  /** @internal */
  _disturbed!: boolean;
  /** @internal */
  _readableStreamController!: ReadableStreamDefaultController<R> | ReadableByteStreamController;

  constructor(underlyingSource: UnderlyingByteSource, strategy?: { highWaterMark?: number; size?: undefined });
  constructor(underlyingSource?: UnderlyingSource<R>, strategy?: QueuingStrategy<R>);
  constructor(underlyingSource: UnderlyingSource<R> | UnderlyingByteSource = {}, strategy: QueuingStrategy<R> = {}) {
    InitializeReadableStream(this);

    const size = strategy.size;
    let highWaterMark = strategy.highWaterMark;

    const type = underlyingSource.type;
    const typeString = String(type);
    if (typeString === 'bytes') {
      if (size !== undefined) {
        throw new RangeError('The strategy for a byte stream cannot have a size function');
      }

      if (highWaterMark === undefined) {
        highWaterMark = 0;
      }
      highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);

      SetUpReadableByteStreamControllerFromUnderlyingSource(this as unknown as ReadableByteStream,
                                                            underlyingSource as UnderlyingByteSource,
                                                            highWaterMark);
    } else if (type === undefined) {
      const sizeAlgorithm = MakeSizeAlgorithmFromSizeFunction(size);

      if (highWaterMark === undefined) {
        highWaterMark = 1;
      }
      highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);

      SetUpReadableStreamDefaultControllerFromUnderlyingSource(this,
                                                               underlyingSource as UnderlyingSource<R>,
                                                               highWaterMark,
                                                               sizeAlgorithm);
    } else {
      throw new TypeError('Invalid type is specified');
    }
  }

  get locked(): boolean {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('locked');
    }

    return IsReadableStreamLocked(this);
  }

  cancel(reason: any = undefined): Promise<void> {
    if (IsReadableStream(this) === false) {
      return promiseRejectedWith(streamBrandCheckException('cancel'));
    }

    if (IsReadableStreamLocked(this) === true) {
      return promiseRejectedWith(new TypeError('Cannot cancel a stream that already has a reader'));
    }

    return ReadableStreamCancel(this, reason);
  }

  getReader({ mode }: { mode: 'byob' }): ReadableStreamBYOBReader;
  getReader(): ReadableStreamDefaultReader<R>;
  getReader(options: { mode?: 'byob' } | undefined = undefined): ReadableStreamDefaultReader<R> | ReadableStreamBYOBReader {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('getReader');
    }

    assertDictionary(options, 'First parameter');

    let mode = options?.mode;
    if (mode === undefined) {
      return AcquireReadableStreamDefaultReader(this, true);
    }

    mode = String(mode) as 'byob';

    if (mode === 'byob') {
      return AcquireReadableStreamBYOBReader(this as unknown as ReadableByteStream, true);
    }

    throw new TypeError('Invalid mode is specified');
  }

  pipeThrough<T>(transform: ReadableWritablePair<T, R>, options: PipeOptions = {}): ReadableStream<T> {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('pipeThrough');
    }

    const readable = transform.readable;
    if (IsReadableStream(readable) === false) {
      throw new TypeError('readable argument to pipeThrough must be a ReadableStream');
    }

    const writable = transform.writable;
    if (IsWritableStream(writable) === false) {
      throw new TypeError('writable argument to pipeThrough must be a WritableStream');
    }

    let { preventAbort, preventCancel, preventClose } = options;
    const signal = options.signal;

    preventClose = Boolean(preventClose);
    preventAbort = Boolean(preventAbort);
    preventCancel = Boolean(preventCancel);

    if (signal !== undefined && !isAbortSignal(signal)) {
      throw new TypeError(`ReadableStream.prototype.pipeThrough's signal option must be an AbortSignal`);
    }

    if (IsReadableStreamLocked(this) === true) {
      throw new TypeError('ReadableStream.prototype.pipeThrough cannot be used on a locked ReadableStream');
    }
    if (IsWritableStreamLocked(writable) === true) {
      throw new TypeError('ReadableStream.prototype.pipeThrough cannot be used on a locked WritableStream');
    }

    const promise = ReadableStreamPipeTo(this, writable, preventClose, preventAbort, preventCancel, signal);

    setPromiseIsHandledToTrue(promise);

    return readable;
  }

  pipeTo(dest: WritableStream<R>, options: PipeOptions = {}): Promise<void> {
    if (IsReadableStream(this) === false) {
      return promiseRejectedWith(streamBrandCheckException('pipeTo'));
    }
    if (IsWritableStream(dest) === false) {
      return promiseRejectedWith(
        new TypeError(`ReadableStream.prototype.pipeTo's first argument must be a WritableStream`));
    }

    let preventAbort;
    let preventCancel;
    let preventClose;
    let signal;
    try {
      ({ preventAbort, preventCancel, preventClose, signal } = options);
    } catch (e) {
      return promiseRejectedWith(e);
    }

    preventClose = Boolean(preventClose);
    preventAbort = Boolean(preventAbort);
    preventCancel = Boolean(preventCancel);

    if (signal !== undefined && !isAbortSignal(signal)) {
      return promiseRejectedWith(
        new TypeError(`ReadableStream.prototype.pipeTo's signal option must be an AbortSignal`));
    }

    if (IsReadableStreamLocked(this) === true) {
      return promiseRejectedWith(
        new TypeError('ReadableStream.prototype.pipeTo cannot be used on a locked ReadableStream'));
    }
    if (IsWritableStreamLocked(dest) === true) {
      return promiseRejectedWith(
        new TypeError('ReadableStream.prototype.pipeTo cannot be used on a locked WritableStream'));
    }

    return ReadableStreamPipeTo(this, dest, preventClose, preventAbort, preventCancel, signal);
  }

  tee(): [ReadableStream<R>, ReadableStream<R>] {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('tee');
    }

    const branches = ReadableStreamTee(this, false);
    return CreateArrayFromList(branches);
  }

  values(options: { preventCancel?: boolean } | undefined = undefined): ReadableStreamAsyncIterator<R> {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('values');
    }

    assertDictionary(options, 'First parameter');

    const preventCancel = Boolean(options?.preventCancel);
    return AcquireReadableStreamAsyncIterator<R>(this, preventCancel);
  }

  [Symbol.asyncIterator]: (options?: { preventCancel?: boolean }) => ReadableStreamAsyncIterator<R>;
}

Object.defineProperties(ReadableStream.prototype, {
  cancel: { enumerable: true },
  getReader: { enumerable: true },
  pipeThrough: { enumerable: true },
  pipeTo: { enumerable: true },
  tee: { enumerable: true },
  values: { enumerable: true },
  locked: { enumerable: true }
});
if (typeof Symbol.toStringTag === 'symbol') {
  Object.defineProperty(ReadableStream.prototype, Symbol.toStringTag, {
    value: 'ReadableStream',
    configurable: true
  });
}
if (typeof Symbol.asyncIterator === 'symbol') {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    value: ReadableStream.prototype.values,
    writable: true,
    configurable: true
  });
}

export {
  ReadableByteStreamControllerCallback,
  ReadableStreamAsyncIterator,
  ReadableStreamDefaultControllerCallback,
  ReadableStreamErrorCallback,
  ReadResult,
  UnderlyingByteSource,
  UnderlyingSource
};

// Abstract operations for the ReadableStream.

// Throws if and only if startAlgorithm throws.
export function CreateReadableStream<R>(startAlgorithm: () => void | PromiseLike<void>,
                                        pullAlgorithm: () => Promise<void>,
                                        cancelAlgorithm: (reason: any) => Promise<void>,
                                        highWaterMark = 1,
                                        sizeAlgorithm: QueuingStrategySizeCallback<R> = () => 1): ReadableStream<R> {
  assert(IsNonNegativeNumber(highWaterMark) === true);

  const stream: ReadableStream<R> = Object.create(ReadableStream.prototype);
  InitializeReadableStream(stream);

  const controller: ReadableStreamDefaultController<R> = Object.create(ReadableStreamDefaultController.prototype);

  SetUpReadableStreamDefaultController(
    stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm
  );

  return stream;
}

// Throws if and only if startAlgorithm throws.
export function CreateReadableByteStream(startAlgorithm: () => void | PromiseLike<void>,
                                         pullAlgorithm: () => Promise<void>,
                                         cancelAlgorithm: (reason: any) => Promise<void>,
                                         highWaterMark = 0,
                                         autoAllocateChunkSize: number | undefined = undefined): ReadableStream<Uint8Array> {
  assert(IsNonNegativeNumber(highWaterMark) === true);
  if (autoAllocateChunkSize !== undefined) {
    assert(NumberIsInteger(autoAllocateChunkSize) === true);
    assert(autoAllocateChunkSize > 0);
  }

  const stream: ReadableStream<Uint8Array> = Object.create(ReadableStream.prototype);
  InitializeReadableStream(stream);

  const controller: ReadableByteStreamController = Object.create(ReadableByteStreamController.prototype);

  SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark,
                                    autoAllocateChunkSize);

  return stream;
}

function InitializeReadableStream(stream: ReadableStream) {
  stream._state = 'readable';
  stream._reader = undefined;
  stream._storedError = undefined;
  stream._disturbed = false;
}

export function IsReadableStream(x: any): x is ReadableStream {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readableStreamController')) {
    return false;
  }

  return true;
}

export function IsReadableStreamDisturbed(stream: ReadableStream): boolean {
  assert(IsReadableStream(stream) === true);

  return stream._disturbed;
}

export function IsReadableStreamLocked(stream: ReadableStream): boolean {
  assert(IsReadableStream(stream) === true);

  if (stream._reader === undefined) {
    return false;
  }

  return true;
}

// ReadableStream API exposed for controllers.

export function ReadableStreamCancel<R>(stream: ReadableStream<R>, reason: any): Promise<void> {
  stream._disturbed = true;

  if (stream._state === 'closed') {
    return promiseResolvedWith(undefined);
  }
  if (stream._state === 'errored') {
    return promiseRejectedWith(stream._storedError);
  }

  ReadableStreamClose(stream);

  const sourceCancelPromise = stream._readableStreamController[CancelSteps](reason);
  return transformPromiseWith(sourceCancelPromise, noop);
}

export function ReadableStreamClose<R>(stream: ReadableStream<R>): void {
  assert(stream._state === 'readable');

  stream._state = 'closed';

  const reader = stream._reader;

  if (reader === undefined) {
    return;
  }

  if (IsReadableStreamDefaultReader<R>(reader)) {
    reader._readRequests.forEach(readRequest => {
      readRequest._resolve(ReadableStreamCreateReadResult<R>(undefined, true, reader._forAuthorCode));
    });
    reader._readRequests = new SimpleQueue();
  }

  defaultReaderClosedPromiseResolve(reader);
}

export function ReadableStreamError<R>(stream: ReadableStream<R>, e: any): void {
  assert(IsReadableStream(stream) === true);
  assert(stream._state === 'readable');

  stream._state = 'errored';
  stream._storedError = e;

  const reader = stream._reader;

  if (reader === undefined) {
    return;
  }

  if (IsReadableStreamDefaultReader<R>(reader)) {
    reader._readRequests.forEach(readRequest => {
      readRequest._reject(e);
    });

    reader._readRequests = new SimpleQueue();
  } else {
    assert(IsReadableStreamBYOBReader(reader));

    reader._readIntoRequests.forEach(readIntoRequest => {
      readIntoRequest._reject(e);
    });

    reader._readIntoRequests = new SimpleQueue();
  }

  defaultReaderClosedPromiseReject(reader, e);
}

// Readers

export type ReadableStreamReader<R> = ReadableStreamDefaultReader<R> | ReadableStreamBYOBReader;

export {
  ReadableStreamDefaultReader,
  ReadableStreamBYOBReader
};

// Controllers

export {
  ReadableStreamDefaultController,
  ReadableStreamBYOBRequest,
  ReadableByteStreamController
};

// Helper functions for the ReadableStream.

function streamBrandCheckException(name: string): TypeError {
  return new TypeError(`ReadableStream.prototype.${name} can only be used on a ReadableStream`);
}
