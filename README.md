## About priority-redlock

Provides an easy way to coordinate independent components that need access to a shared resource.  It extends the [Redlock](https://redis.io/topics/distlock) algorithm, with the concept of priority added on. Priority at it's core allows lock holders to coordinate with each other without explict knowledge of each other.  To automatically wrap some of the complexity of managing locks into a convenient Generator-based API, check out [gen-lock](https://github.com/gittyeric/gen-lock), which is probably what you really need.

This repository comes with an in-memory LockingProtocol implementation, useful for coordinating multiple scripts running within the same JS runtime.  Stay tuned for the distributed LockingProtocol implementation in Redis.  If you need a distributed lock _right now without_ priorities, there's lots of good vanilla Redlock implementations on npm.

## Features

- Low-level async aquire / release interface
- Priority-based locking
- Re-entrant per lock holder
- Combine multiple locks in fun ways to deadlock yourself

## Installation

```
npm install priority-redlock
```

#### Example 1: Atomic Transactions

Say you need to guarantee that only *1* process accesses a shared resource at a time.  This library lets you do this at a low level, but you'll probably prefer [this library](https://github.com/gittyeric/gen-lock) to make it super easy using ES6 Generators, which uses this library internally.  Here's the low-level way:

```
var aquire = require('priority-redlock')();

var transaction = function() {
    console.log('A buncha operations')
};

// Try hogging a lock forever and printing messages
aquire('resourceToLock', 'locker1')
    .then((lock) => {
        // Do something with exclusive access to resourceLock
        transaction();
        lock.release(); // Let others lock resourceToLock
    })

// locker2 has same priority and will wait for locker1 to release
aquire('resourceToLock', 'locker2')
    .then((lock) => {
        // Do something while locker1 does not hold resourceToLock
        transaction();
        lock.release();
    })
```

#### Example 2: Decentralized + Prioritized process coordination

Say you need to have many processes greedily attempt command a shared resource as often as possible, while letting
certain processes take precedence over others.  In this case let's define a 'save energy' task and an 'motion detected' task that can both control
a series of light bulbs in an office, where the motion detector's transaction will preempt or cancel energy saving:

```
var aquire = require('priority-redlock')();
var LIGHTS = 'lights';

aquire(LIGHTS, 'save energy')
    .then(async (lock) => {
        // Turn off all the lights but mine
        await turnOffKitchenLights();
        if (!lock.isHeld())
            throw new Error('Interrupted by Admin');
        await turnOffMeetingRoomLights();
        lock.release(); // Let others lock LIGHTS
    });

// Motion detected task has higher priority and will cancel 'save energy'
aquire(LIGHTS, 'motion detected', { priority: 100 })
    .then(async (lock) => {
        // Do something while 'save energy' does not hold LIGHTS
        await turnOnKitchenLights();
        await turnOnMeetingRoomLights();
        lock.release();
    });
```

#### Example 3: Aquire multiple locks

Perhaps you have 2 processes that independently manage a KITCHEN_LIGHT and a BEDROOM_LIGHT, but
want to give a 3rd security process absolute authority over both KITCHEN_LIGHT and BEDROOM_LIGHT,
so that the first 2 processes are locked out as long as security runs.

var aquire = require('priority-redlock')();
var aquireAll = require('priority-redlock').aquireAll;
var KITCHEN_LIGHT = 'kitchen light';
var BEDROOM_LIGHT = 'bedroom light';

//... Assume some fun apps that use these
var kitchenLock = aquire(KITCHEN_LIGHT, 'fun kitchen app')
var bedroomLock = aquire(BEDROOM_LIGHT, 'fun bedroom app')

// Trigger a security alarm!
// Use priority: 100 to hog both locks from above
aquireAll([
    () => aquire(KITCHEN_LIGHT, 'sec', { priority: 100 }),
    () => aquire(BEDROOM_LIGHT), 'sec', { priority: 100 },
])
// This promise will complete quickly since it
// cancels kitcheLock and bedroomLock
    .then(async (compositeLock) => {
        await flashSecurityLights()
        compositeLock.release();
    })


## API

#### Default Import

aquireFactory = () => Aquire

The default export of this library.  A factory function that returns an Aquire function.
Each aquire created from the factory respects locks in it's factory's scope; aquires from
different factories will not respect each other.

#### AquireFactory

aquire(resourceGuid: string, lockerId: string, options?: AquireOptions) => Promise<Lock>

Returns a Promise for a Lock that can later be released.  The lock represents having exclusive
access to whatever resourceGuid represents, to be held by lockerId.  The lock can only be
aquired by a single lockerId at a time, though re-entrance is possible by aquiring the Lock
multiple times with the same lockerId.  For this reason, always use unique lockerIds unless
you're purposely allowing parallel aquires for the same resourceGuid / lockerId combination.

#### Named Imports

aquireAll((() => Aquire)[], aquireTimeout: number = Infinity) => Promise<Lock>

Takes an array of Aquire generators, functions that return a call to aquire, and returns
a Promise for a composite Lock that guarantees exclusive access to all the underlying
Locks that were generated.

#### Aquire Options

You probably want to set lockTtl at the least to ensure other processes can eventually aquire
even if your crappy code forgot to release() the lock.  aquireTimeout is also a good idea.

```
interface AquireOptions {
    priority?: number,  // Higher priority aquires will cancel current lock holders, default Number.MIN
    lockTtl?: number,  // Time to hold the lock starting from lock obtain time, in ms, default Number.POSITIVE_INFINITY
    aquireTimeout?: number, // Time to wait for aquiring lock, in ms, default Number.POSITIVE_INFINITY
    maxAquireAttempts?: number, // Max number of times to try aquiring a lock, default Number.POSITIVE_INFINITY
}
```

### Gotchas

- You probably want to use [gen-lock](https://github.com/gittyeric/gen-lock) for both a simpler interface and to avoid forgetting to release() your aquired locks.
- The default LockingProtocol provided is in-memory, meaning the locking scope is only the 1 Javascript runtime you're running in.  A Redis impl is on it's way so the scope of the lock can be galactic.
- Javascript can pause for a long time, giving you the chance to run code just after a lock has actually expired (by TTL) in an unavoidable way.  If you need mathematical-level consistency, try using a real programming language.


### TODO for version 1

- 100% Test Coverage (only dumb edge cases remain!)
- Finish [formal-ish proof](specs.md) of consistency and liveliness in presence of priority features

#### Coming Soon: dist-priority-redlock

Work is currently underway to implement the LockingProtocol using distributed state so you can reuse
any code written against this lib to lock resources among many independent JS runtimes!  This will
contain the same features but be backed by Redis for distributed coordination.  In the meatime,
check out the great Redlock npm libraries that enable a subset of features in a distributed way, or dare to
implement the 5 functions in LockingProtocol in a database of your choice!