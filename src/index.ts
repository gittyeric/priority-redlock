import { aquire, Aquire } from './aquire'
import { mergeWithDefaultOptions } from './util'
import { LockingProtocol, AquireOptions } from './lockingProtocol'
import uuid from 'uuid/v4'
import * as utils from './util'
import { newInMemoryLockingProtocol } from './inMemLocking'

// ----------- Hopefully all you need -----------------
export default function aquireFactory(protocol: LockingProtocol = newInMemoryLockingProtocol()): Aquire {
    const boundAquire = aquire(protocol)
    return (resouceGuid: string, lockerGuid: string = uuid(), options?: AquireOptions) =>
        boundAquire(resouceGuid, lockerGuid, mergeWithDefaultOptions(options))
}
export { aquireAll } from './lockOps'

// ----------- High-level APIs ------------------------
export { aquire } from './aquire'
export { Lock, LockState, LockHeldState } from './release'

// ----------- Low-level internal stuff -------------
export { newInMemoryLockingProtocol } from './inMemLocking'
export { Dispatcher, Handler, Handlers, Off, newDispatcher } from './eventDispatcher'
export {
    AquireOptions, DefinedAquireOptions,
    LOCK_ALREADY_AQUIRED, LOCK_AQUIRE_TIMEOUT, LOCK_RELEASED, LOCK_STOLEN_BY_HIGHER_PRIORITY, LOCK_TIMED_OUT,
    LOCK_ERROR_NAME, LockError, LockErrorType, LockErrorTypes,
    LockingProtocol,
    Obtain, ObtainDenied, ObtainResult, ObtainSuccess, ObtainedByReentrance, ObtainedFromVictim,
    PRIORITY_MAX, PRIORITY_MEDIUM, PRIORITY_MIN,
    Release, ReleaseListener, ReleaseReason, TheifListener, VictimNotifier,
    defaultOptions,
} from './lockingProtocol'
export const util = utils