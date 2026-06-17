function createStrategyRegistry(defaultStrategy = null) {
  const strategies = new Map();

  return {
    register(key, strategy) {
      strategies.set(String(key), strategy);
      return strategy;
    },

    get(key) {
      return strategies.get(String(key)) || defaultStrategy;
    },

    keys() {
      return Array.from(strategies.keys());
    }
  };
}

module.exports = {
  createStrategyRegistry
};
