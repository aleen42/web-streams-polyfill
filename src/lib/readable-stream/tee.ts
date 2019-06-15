import {
  AcquireReadableStreamDefaultReader,
  CreateReadableStream,
  IsReadableStream,
  ReadableStream,
  ReadableStreamCancel,
  ReadableStreamDefaultController,
  ReadableStreamDefaultControllerClose,
  ReadableStreamDefaultControllerEnqueue,
  ReadableStreamDefaultControllerError,
  ReadableStreamDefaultReaderRead
} from '../readable-stream';
import assert from '../../stub/assert';
import { createArrayFromList, typeIsObject } from '../helpers';
import { rethrowAssertionErrorRejection } from '../utils';

export function ReadableStreamTee<R>(stream: ReadableStream<R>,
                                     cloneForBranch2: boolean): [ReadableStream<R>, ReadableStream<R>] {
  assert(IsReadableStream(stream) === true);
  assert(typeof cloneForBranch2 === 'boolean');

  const reader = AcquireReadableStreamDefaultReader<R>(stream);

  let reading = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1: any;
  let reason2: any;
  let branch1: ReadableStream<R>;
  let branch2: ReadableStream<R>;

  let resolveCancelPromise: (reason: any) => void;
  const cancelPromise = new Promise<any>(resolve => {
    resolveCancelPromise = resolve;
  });

  function pullAlgorithm(): Promise<void> {
    if (reading === true) {
      return Promise.resolve();
    }

    reading = true;

    const readPromise = ReadableStreamDefaultReaderRead(reader).then(result => {
      reading = false;

      assert(typeIsObject(result));
      const done = result.done;
      assert(typeof done === 'boolean');

      if (done === true) {
        if (canceled1 === false) {
          ReadableStreamDefaultControllerClose(branch1._readableStreamController as ReadableStreamDefaultController<R>);
        }
        if (canceled2 === false) {
          ReadableStreamDefaultControllerClose(branch2._readableStreamController as ReadableStreamDefaultController<R>);
        }
        return;
      }

      const value = result.value!;
      const value1 = value;
      const value2 = value;

      // There is no way to access the cloning code right now in the reference implementation.
      // If we add one then we'll need an implementation for serializable objects.
      // if (canceled2 === false && cloneForBranch2 === true) {
      //   value2 = StructuredDeserialize(StructuredSerialize(value2));
      // }

      if (canceled1 === false) {
        ReadableStreamDefaultControllerEnqueue(
          branch1._readableStreamController as ReadableStreamDefaultController<R>,
          value1
        );
      }

      if (canceled2 === false) {
        ReadableStreamDefaultControllerEnqueue(
          branch2._readableStreamController as ReadableStreamDefaultController<R>,
          value2
        );
      }
    });

    readPromise.catch(rethrowAssertionErrorRejection);

    return Promise.resolve();
  }

  function cancel1Algorithm(reason: any): Promise<void> {
    canceled1 = true;
    reason1 = reason;
    if (canceled2 === true) {
      const compositeReason = createArrayFromList([reason1, reason2]);
      const cancelResult = ReadableStreamCancel(stream, compositeReason);
      resolveCancelPromise(cancelResult);
    }
    return cancelPromise;
  }

  function cancel2Algorithm(reason: any): Promise<void> {
    canceled2 = true;
    reason2 = reason;
    if (canceled1 === true) {
      const compositeReason = createArrayFromList([reason1, reason2]);
      const cancelResult = ReadableStreamCancel(stream, compositeReason);
      resolveCancelPromise(cancelResult);
    }
    return cancelPromise;
  }

  function startAlgorithm() {}

  branch1 = CreateReadableStream(startAlgorithm, pullAlgorithm, cancel1Algorithm);
  branch2 = CreateReadableStream(startAlgorithm, pullAlgorithm, cancel2Algorithm);

  reader._closedPromise.catch((r: any) => {
    ReadableStreamDefaultControllerError(branch1._readableStreamController as ReadableStreamDefaultController<R>, r);
    ReadableStreamDefaultControllerError(branch2._readableStreamController as ReadableStreamDefaultController<R>, r);
  });

  return [branch1, branch2];
}
