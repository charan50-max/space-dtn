
from backend.app.dtn.simulator import DTNSimulator

class Store:
    def __init__(self):
        self._items = {}
    def get(self, simulation_id):
        if simulation_id not in self._items:
            self._items[simulation_id] = DTNSimulator()
        return self._items[simulation_id]
    def reset(self, simulation_id):
        self._items[simulation_id] = DTNSimulator()
        return self._items[simulation_id]

simulation_store = Store()
