// Helper functions for proofs and whatnot, WORK IN PROGRESS

var f = [];
function factorial (n) {
  if (n == 0 || n == 1)
    return 1;
  if (f[n] > 0)
    return f[n];
  f[n] = factorial(n-1) * n;
  return f[n]
} 

const ofNPickK = (n, k) =>
    factorial(n) / (factorial(k)*(factorial(n - k)))

const probabilityDensityOfChainLen = (n, priorityCardinality) => {
    return ofNPickK(priorityCardinality - 1, n - 1)
}

const expectedChainLen = (priorityCardinality) => {
    let density = 0
    const densities = []
    for (let i = 1; i <= priorityCardinality; i++) {
        densities.push(probabilityDensityOfChainLen(i, priorityCardinality))
        density += densities[i-1]
    }
    console.log(density)
    const probs = densities.map((d) => d / density)
    return probs.reduce((sum, p, i) => sum + (i+1) * p, 0)
}

// A script to find average Chain of Thief length
// under worst-case contention scenarios, as a function
// of the number of unique priorities
const end = 173  // JS numeric precision breaks at 172
for (var priorityCardinality = 160; priorityCardinality < end; priorityCardinality += 1)
  console.log(priorityCardinality + ": " + expectedChainLen(priorityCardinality))