export const PRIORITY_MIN = Number.MIN_VALUE
export const PRIORITY_MEDIUM = 0
export const PRIORITY_MAX = Number.MAX_VALUE


export type LOCK_AQUIRE_TIMEOUT = 'Lock Aquire Timeout'
export const LOCK_AQUIRE_TIMEOUT = 'Lock Aquire Timeout'
export type LOCK_TIMED_OUT = 'Lock Timeout'
export const LOCK_TIMED_OUT = 'Lock Timeout'
export type LOCK_RELEASED = 'Lock Released'
export const LOCK_RELEASED = 'Lock Released'
export type LOCK_ALREADY_AQUIRED = 'Lock Already Aquired'
export const LOCK_ALREADY_AQUIRED = 'Lock Already Aquired'
export type LOCK_STOLEN_BY_HIGHER_PRIORITY = 'Lock Stolen by Higher Priority'
export const LOCK_STOLEN_BY_HIGHER_PRIORITY = 'Lock Stolen by Higher Priority'

export type LockErrorType =
    LOCK_AQUIRE_TIMEOUT |
    LOCK_TIMED_OUT |
    LOCK_ALREADY_AQUIRED |
    LOCK_RELEASED |
    LOCK_STOLEN_BY_HIGHER_PRIORITY

export const LockErrorTypes = [
    LOCK_AQUIRE_TIMEOUT,
    LOCK_TIMED_OUT,
    LOCK_ALREADY_AQUIRED,
    LOCK_RELEASED,
    LOCK_STOLEN_BY_HIGHER_PRIORITY,
]

export const LOCK_ERROR_NAME = 'Lock Error'
export type LOCK_ERROR_NAME = 'Lock Error'
export interface LockError<T extends LockErrorType> extends Error {
    name: LOCK_ERROR_NAME,
    code: T
}

export type ReleaseReason = LOCK_RELEASED | LOCK_STOLEN_BY_HIGHER_PRIORITY | LOCK_TIMED_OUT

export interface AquireOptions {
    priority?: number,  // Higher priority aquires will cancel current lock holders
    lockTtl?: number,  // Time to hold the lock starting from lock obtain time, in ms
    aquireTimeout?: number, // Time to wait for aquiring lock, in ms
    maxAquireAttempts?: number, // Max number of times to try aquiring a lock
}

export interface DefinedAquireOptions extends AquireOptions {
    priority: number,
    lockTtl: number,
    aquireTimeout: number,
    maxAquireAttempts: number,
}

export const defaultOptions: DefinedAquireOptions = {
    priority: PRIORITY_MEDIUM,
    aquireTimeout: Number.POSITIVE_INFINITY,
    lockTtl: Number.POSITIVE_INFINITY,
    maxAquireAttempts: Number.POSITIVE_INFINITY,
}


export interface ObtainSuccess {
    aquisitionId: string,
    obtainTimestamp: number, // MUST be <= actual obtain time in Key/Value store
    lockTtl: number,
}

export interface ObtainedFromVictim extends ObtainSuccess {
    exLockerGuid: string, // TODO: needed?
    exAquisitionId: string,
}

export interface ObtainedByReentrance extends ObtainSuccess {
    oldPriority: number,
}

export interface ObtainDenied {
    currentLockerPriority: number,
}

export type ObtainResult = ObtainSuccess | ObtainedFromVictim | ObtainedByReentrance | ObtainDenied

// Returns a promise for an ObtainResult on a given resource
// Can resolve to ObtainSuccess, ObtainedFromVictim, or ObtainDenied
// Should auto-retry until rejecting after timeout ms elapses
export type Obtain = (resourceGuid: string, lockerId: string, aquisitionId: string, options: DefinedAquireOptions, timeout: number) => Promise<ObtainResult>


// Requests to globally unlock a resource
// Only unlock if the current aquisitionId matches
// Should auto-retry forever until the unlock completes or reject after timeout ms have passed
// Resolves a promise for Errors that could occur but still guarantee the lock is released, or
// undefined if previously held and now sucessfully released
// Should ONLY reject with an error if the release call cannot guarantee the lock was released within timeout ms
export type Release = (aquisitionIdToUnlock: string, i: number, resourceGuid: string, timeout: number) => Promise<Error | undefined>

// Listens for a theif notification and rejects the promise upon notification.  Resolves if timeout is reached
export type TheifListener = (listener: () => void, aquisitionId: string, resourceGuid: string, timeout: number) => void

// Returns a promise that rejects when resource under aquisitionId is unlocked or
// resolves when timeout expires
// Should auto-retry until timeout ms elapses
export type ReleaseListener = (listener: (reason: ReleaseReason) => void, aquisitionId: string, resoureceGuid: string, timeout: number) => void

// Let the victim know you just stole the lock.  Resolved Promise implies victim acknowledgement.
// Should auto-retry until timeout ms elapses.  Returned Promise should NEVER reject
export type VictimNotifier = (victimAquisitionId: string, aquisitionId: string, resourceGuid:string, timeout: number) => Promise<void>

// Implement this for a custom priority-redlock implementation
export interface LockingProtocol {
    obtain: Obtain,
    release: Release,
    listenForTheif: TheifListener,
    listenForUnlock: ReleaseListener,
    notifyVictim: VictimNotifier,
}