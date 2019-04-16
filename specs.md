# SPEC IS WORK IN PROGRESS
# TODO: Finish this document!!!!
# Scattered notes that are partly wrong

### Lock Protocol Details

The lock underlying this library is an extension of the [Redlock algorithm](https://redis.io/topics/distlock), with a slightly modified aquire operation that requires lock
contenders to have a request/response communication channel between them.  This library comes with an in-memory implementation so the locks are only scoped to
a single Javascript runtime, but your distributed implementation could use Redis Pub/Sub, HTTP, P2P etc. for this channel.

#### Modification to Redlock's aquire

The modified aquire now requires a slightly more complex operation than set-if-empty.  The function instead sets a key/value entry if empty
_or_ if the value there has a priority less than the incoming aquire attempt's value.  In the case of aquiring when not empty, the operation
should return the current unique aquisitionId used by the original lock holder (as well as information needed for contacting the original holder).
With the lock now "stolen", the thief is responsible for not acting upon the lock until confirming with the victim that it has lost
lock ownership.  Upon acknowledgement from the victim, the thief can now act upon the lock.  The "stolenConsistencyFactor" flag
controls how long the thief should wait for confirmation from the victim, with 1 being 100% of the aquire TTL to zero being no wait at all.

Note! It's important for liveliness guarantees that a process of equal priority _not_ be able to steal locks from equal processes.

##### Consistency & Liveliness for Modified Aquire

For all Redlock edge cases, consistency & liveliness is (arguably) proven, so this attempts to enumerate only new cases introduced by the priority feature:

1. Lock is "stolen" but the theif crashes before confirmation
   In this case, only the TTL of the theif's lock aquisition will cause the lock to expire.  A fortunate side effect is that the victim
   will hum along as if nothing happened, but unfortunately over-protected by the theif's higher priority.  As long as your definition
   of consistency does not include "no process should hold a lock under elevated priority", then this is still consistent.  TTL clearly
   maintains liveliness as well.
2. Theif confirms a stolen aquisition but cannot contact victim
   Here the theif will time out as though the lock was never aquired, ensuring consistency while the victim proceeds unhindered.  Consistency
   and liveliness guarantees and caveats are the same as edge case 1.
3. Theif confirms stolen aquisition, notifies victim successfully but receives no acknowledgement
   This case will temporarily deadlock both theif and victim until the theif's lock times out.  This is a worst case scenario,
   but consistency is maintained and liveliness is guaranteed after theif lock TTL.
4. A "master theif" of highest priority steals the lock during theif's aquisition hand shake
   This thorny case can be handled somewhat simply to maintain guarantees.  If at any point the theif receives
   a lock stolen signal from the master theif, the theif will delay acknowledgement until first receiving acknowledgement from
   the vicim.  Aquire TTLs maintain strong liveliness with a caveat proven away in "Chain of Theives Partial Deadlock".

##### Caveats on Consistency

###### 1. Javascript
It's the author's sad admission to say that there is 1 small caveat around consistency that shouldn't really matter in practice.  Javascript
may at times have arbitrary, long delays between execution where upon waking up, thinks it still has a since-expired lock.  There's no
great _practical_ way around this, other than to say as long as you avoid CPU-intensive tasks while holding a lock, you'll be _close enough_
to consistency in practice.  This should rarely be a problem, because you wouldn't seriously do heavy number crunching in JS would you? ;-)
If absolute consistency is important for you, especially when CPU heavy, you should consider a real programming language.

###### 2. Chain of Theives Partial Deadlock

In the extreme version of [Edge Case 4](Consistency & Liveliness for Modified Aquire), a chain of queued, ever-higher priority theifs 
that form a linked list to guarantee consistency is called a "Chain of Theives".
This section proves that CofT does not compromise liveliness in the limit, and gives suggestions on how one might tune aquire TTLs
to help avoid the occurrence of this problem in practice.

####### 2a. Probabilities of Large Chain Lengths

Here's a proof showing that there's a hard bound to how large chains can realistically become.

Let P(priority=x) be the probability that aquirer with priority x has aquired L

Then the probability of a sequential chain of length N is:
!!!!

P(priority=1) * P(priority=2) * ... * P(priority=M) =
1 / P * 1 / (P - 1) * ... * 1 / 1 =
π (1 / (P - i)) for integers i = N-1 to 0

In the limit, the probability of a full chain forming drops asymptotically to zero as P increases, proving
that there's a bound to the length of these chains even for large P.

####### 2b. Calculating Aquire TTLs to avoid CofT Aquire Timeouts

For the number of priority values P that you use, keep in mind that the aquire TTL you use needs to rise.  This is because the bigger
|P| is, the higher the probability of building a chain of theives, each waiting for the slightly less priority lock holder to confirm
aquisition.  When this happens, the highest priority theif may have to wait long enough to reach it's aquire TTL, rending the locked resource
useless until released.  In the meantime, with a worst-case probability of 1/|P|, the lowest-priority victim could regain the lock, retriggering
the chain and creating a deadlock.  The probability of eternal deadlock is zero of course, but the following expression should educate you
on how to balance priority cardinality with aquire TTLs:

Worst case Assumption: All lock aquirers are attempting to aquire lock L as quickly as possible
Let T be the aquire TTL
Let M be the highest priority in P, the "master theif" priority
Let A be the average time to complete a stolen aquire handshake

A "round" is defined by the initial locking of L by any element of P, finally escalating to being locked by M.
The probability of the "length" of a round, or how many theives temporarily aquire L can be derived as follows:

Then, a deadlock round will occur when the highest priority theif's aquire times out, and can be described when:

T < A * N, where N is the number of theives in the chain

Let's find the average N to help decide what T should be, since we can't often control A.

A chain of 1 forms when M is the first and only aquirer, with P(priority=M) = 1/|P|
A chain of 2 has P(priority=M) * P(priority!=M) = (1 / P) * (1 / (P - 1))
...
Let C(N) be the probability of chain length N: C(N) = π (1 / (P - i)) for integers i = N-1 to 0

Given this, we can find the _expected value_ of N:

E(P) = Σ (i * C(i)) for i = 1 to P

For concreteness, 100 priority levels average a chain length of 0.010205, so if we average 5ms
for a stolen lock aquire, we should have an aquire TTL of at least:

T >= 5ms * 10
T >= 

to avoid timing out during an aquire under worst-case contention circumstances _on average_.

Version 1 of this library will use the expected value above combined with sampling to auto-tune the time to wait for a victim
to acknowledge a theft when guaranteeConsistency is false.  This will provide the perfect balance of high (but imperfect) consistancy along with
optimal aquire performance when victims go down.