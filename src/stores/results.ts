import { defineStore } from 'pinia'

export const useResultsStore = defineStore('resultsStore', {
  state: (): ResultsStore => ({
    results: {
      data: [],
    },
    fetching: false,
  }),
  getters: {

  },
  actions: {

  }
})
