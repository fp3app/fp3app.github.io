<script setup lang="ts">
import { ref, onMounted, computed, watchEffect } from 'vue'
import { nextTick } from 'vue'
import { useResultsStore } from '@/stores/results'

const resultsStore = useResultsStore()

const rawHTMLContent = ref('')
const headerText = ref('')
const localStorageKey = 'fetchedHTMLContent'
const sortState = ref({ column: 'Chassis', isAscending: true })
const minLapsFilter = ref(0)
const minLaps = ref(0)
const maxLaps = ref(0)
const lapDifference = ref(0)
const minTimeDiffPercent = ref(0)
const maxTimeDiffPercent = ref(100)
const minTimeDifference = ref(0)
const maxTimeDifference = ref(100)
const setSuggestedValsChecked = ref(false)

onMounted(async () => {
  await getResults()
})

const getResults = async (reFetch = false) => {
  resultsStore.fetching = true

  let htmlContent = ''
  let headerHtmlContent = ''

  // Try to retrieve from localStorage first
  const storedContent = localStorage.getItem(localStorageKey)
  const storedHeaderContent = localStorage.getItem(`${localStorageKey}-header`)
  if (storedContent && storedHeaderContent && !reFetch) {
    htmlContent = storedContent
    headerHtmlContent = storedHeaderContent
  } else {
    // If not found in localStorage, fetch from the URL
    try {
      const response = await fetch(
        'http://localhost:3000/fetch-html?url=https://www.autosport.com/f1/results/'
      )
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const data = await response.json()
      // Assuming the HTML content is now split into two parts: tableHtml and headerHtml
      htmlContent = data.tableHtml
      headerHtmlContent = data.headerHtml

      // Store the fetched content in localStorage
      localStorage.setItem(localStorageKey, htmlContent)
      localStorage.setItem(`${localStorageKey}-header`, headerHtmlContent)
    } catch (error) {
      console.error('Failed to fetch HTML content:', error)
      resultsStore.fetching = false
      return
    }
  }

  resultsStore.fetching = false

  // Process the HTML content
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlContent, 'text/html')
  const headerDoc = parser.parseFromString(headerHtmlContent, 'text/html')

  // Clean up the HTML content
  doc.body.querySelectorAll('*').forEach((el) => {
    // Remove all attributes
    while (el.attributes.length > 0) {
      el.removeAttribute(el.attributes[0].name)
    }

    if (el.tagName === 'TABLE') {
      el.setAttribute('class', 'table is-striped is-narrow is-hoverable')
      el.setAttribute('id', 'fp3-table')
      const thead = el.querySelector('thead')
      if (thead) {
        const firstTr = thead.querySelector('tr')
        if (firstTr) {
          firstTr.remove()
        }
      }
    }

    if (el.tagName === 'A') {
      const span = document.createElement('span')
      span.innerHTML = el.innerHTML
      if (el.parentNode) {
        el.parentNode.replaceChild(span, el)
      }
    }
  })

  // Clean up the header HTML content by removing all html tags leaving only the inner text
  headerText.value = headerDoc.body?.textContent?.trim() || ''

  const serializer = new XMLSerializer()
  let serializedHTML = serializer.serializeToString(doc.body)

  // Minify HTML content by removing unnecessary white spaces and line breaks
  serializedHTML = serializedHTML.replace(/\n/g, '').replace(/\s\s+/g, ' ')
  rawHTMLContent.value = serializedHTML

  nextTick().then(() => {
    tableToJson('#fp3-table')
    getMinMaxLaps()
  })
}

const tableToJson = (tableSelector: string) => {
  const table = document.querySelector(tableSelector)
  let rows
  if (table) {
    rows = table.querySelectorAll('tr')
  } else {
    console.error('Table not found')
    return
  }
  const jsonArray: DriverResult[] = []
  const headers: string[] = []
  const headerCells = rows[0].querySelectorAll('th')
  headerCells.forEach((header: HTMLElement) => {
    headers.push(header.innerText)
  })
  if (headers.length === 0) {
    rows[0].querySelectorAll('td').forEach((header: HTMLElement) => {
      headers.push(header.innerText)
    })
  }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const cells = row.querySelectorAll('td')
    const rowObject: Partial<DriverResult> = {}
    cells.forEach((cell: HTMLElement, index: number) => {
      const key: keyof DriverResult = (headers[index] as keyof DriverResult) || `column${index}`
      rowObject[key] = cell.innerText.trim().replace(/\s+/g, ' ')
    })
    const exists = resultsStore.results.data.some((result) => result.Driver === rowObject.Driver)
    if (!exists) {
      resultsStore.results.data.push(rowObject as DriverResult)
    }
  }
  return jsonArray
}

const getRowClasses = (result: DriverResult) => {
  // Get result.chassis, convert to lowercase, hyphenate any spaces, and prefix with 'chassis-'
  const chassis = 'chassis chassis--' + result.Chassis.toLowerCase().replace(/\s/g, '-')
  return {
    [chassis]: true
  }
}

// const function to get and set minLaps and maxLaps
const getMinMaxLaps = () => {
  const laps = resultsStore.results.data.map((result) => Number(result.Laps))
  minLaps.value = Math.min(...laps)
  maxLaps.value = Math.max(...laps)
  nextTick().then(() => {
    minLapsFilter.value = minLaps.value
    lapDifference.value = maxLaps.value
  })
}

// Helper function to convert time string to milliseconds
function convertTimeToMilliseconds(time: string | null): number {
  if (!time) return 0

  const match = time.match(/(\d+)'(\d+)\.(\d+)/)
  if (!match) return 0

  const [_, minutesPart, secondsPart, millisecondsPart] = match.map(Number)

  const minutesInMs = minutesPart * 60 * 1000
  const secondsInMs = secondsPart * 1000
  const totalMilliseconds = minutesInMs + secondsInMs + millisecondsPart

  return totalMilliseconds
}

const sortedAndFilteredResults = computed(() => {
  // Group by chassis
  const groupedByChassis = resultsStore.results.data.reduce<Record<string, DriverResult[]>>(
    (acc, result) => {
      if (!acc[result.Chassis]) acc[result.Chassis] = []
      acc[result.Chassis].push(result)
      return acc
    },
    {}
  )

  // Filter based on lap difference and time difference criteria if enabled
  const filteredResults = Object.values(groupedByChassis).reduce<DriverResult[]>(
    (acc, chassisResults) => {
      // Convert time for each result
      const chassisResultsWithTime = chassisResults.map((result) => ({
        ...result,
        timeInMs: convertTimeToMilliseconds(result.Time)
      }))

      // Determine if any lap difference within this chassis exceeds the threshold
      const exceedsLapThreshold = chassisResults.some((result, index, arr) => {
        if (index === 0) return false // No previous item to compare for the first item
        return Math.abs(Number(result.Laps) - Number(arr[index - 1].Laps)) > lapDifference.value
      })

      // Determine if any time difference within this chassis exceeds the threshold
      const exceedsTimeThreshold = chassisResultsWithTime.some((result, index, arr) => {
        if (index === 0) return false // No previous item to compare for the first item
        if (result.timeInMs == null || arr[index - 1].timeInMs == null) return false // Check for null values
        const timeDifference = Math.abs(result.timeInMs - arr[index - 1].timeInMs)
        const percentageDifference = (timeDifference / arr[index - 1].timeInMs) * 100
        return (
          percentageDifference > maxTimeDifference.value ||
          percentageDifference < minTimeDifference.value
        )
      })

      // If no lap or time differences exceed the threshold, include this chassis's results
      if (!exceedsLapThreshold && !exceedsTimeThreshold) acc.push(...chassisResults)
      return acc
    },
    []
  )

  // Apply existing sorting and minimum laps filtering
  return filteredResults
    .filter((result) => Number(result.Laps) >= minLapsFilter.value)
    .sort((a, b) => {
      const valueA = a[sortState.value.column as keyof DriverResult]
      const valueB = b[sortState.value.column as keyof DriverResult]
      if (valueA == null || valueB == null) return 0
      return sortState.value.isAscending
        ? valueA.toString().localeCompare(valueB.toString(), undefined, { numeric: true })
        : valueB.toString().localeCompare(valueA.toString(), undefined, { numeric: true })
    })
})

function toggleSort(column: string) {
  if (sortState.value.column === column) {
    sortState.value.isAscending = !sortState.value.isAscending
  } else {
    sortState.value.column = column
    sortState.value.isAscending = true // Default to ascending on first click
  }
}

function colIsActive(column: string) {
  return sortState.value.column === column ? 'is-selected is-clickable' : 'is-clickable'
}

function getChevronClass(column: string) {
  return sortState.value.column === column && sortState.value.isAscending === true
    ? 'fa-chevron-up'
    : 'fa-chevron-down'
}

function setSuggestedValues(isChecked) {
  console.log(`file: TheResults.vue:261 - setSuggestedValues - isChecked:`, isChecked)
  if (isChecked) {
    // calculate half way between minLaps and maxLaps
    minLapsFilter.value = Math.round((maxLaps.value - minLaps.value) / 2) + minLaps.value
    // set lapDifference.value to 0.8 of maxLaps rounded up to the nearest whole number
    lapDifference.value = Math.ceil(maxLaps.value * 0.8)
    console.log(
      `file: TheResults.vue:265 - setSuggestedValues - lapDifference.value:`,
      lapDifference.value
    )

    minTimeDifference.value = 1.5
    maxTimeDifference.value = 10
  } else {
    // Reset to default values
    getMinMaxLaps()
    minTimeDifference.value = 0
    maxTimeDifference.value = 100
  }
}

// watchEffect for setSuggestedValsChecked that triggers the function setSuggestedValues
watchEffect(() => {
  setSuggestedValues(setSuggestedValsChecked.value)
})
</script>

<template>
  <section class="container mb-6">
    <h2 class="title is-3">{{ headerText }} (FP3)</h2>
  </section>
  <section class="container mb-6">
    <div class="box">
      <h3 class="title is-4">Filter Options</h3>
      <div class="columns is-multiline">
        <div class="column is-full-mobile is-half-tablet">
          <!-- Minimum Laps -->
          <div class="field">
            <label class="label" for="minLapsSlider">Minimum Laps</label>
            <div class="control has-icons-left has-icons-right">
              <input
                class="input has-output is-fullwidth"
                type="range"
                :min="minLaps"
                :max="maxLaps"
                step="1"
                id="minLapsSlider"
                v-model.number="minLapsFilter"
                tooltip="always"
                tooltip-placement="bottom"
              />
              <span class="icon is-small is-left">
                <i class="fas fa-tachometer-alt"></i>
              </span>
              <span class="icon is-small is-right">
                <output for="minLapsSlider">{{ minLapsFilter }}</output>
              </span>
            </div>
          </div>
        </div>
        <div class="column is-full-mobile is-half-tablet">
          <div class="field">
            <!-- Lap Difference -->
            <label class="label" for="lapDifference">Lap Difference</label>
            <div class="control has-icons-left has-icons-right">
              <input
                class="input has-output is-fullwidth"
                type="range"
                :min="0"
                :max="maxLaps"
                step="1"
                id="lapDifference"
                v-model.number="lapDifference"
                tooltip="always"
                tooltip-placement="bottom"
              />
              <span class="icon is-small is-left">
                <i class="fas fa-exchange-alt"></i>
              </span>
              <span class="icon is-small is-right">
                <output for="lapDifference">{{ lapDifference }}</output>
              </span>
            </div>
          </div>
        </div>
        <div class="column is-full-mobile is-half-tablet">
          <div class="field">
            <!-- Min Time Difference -->
            <label class="label" for="timeDifference">Minimum Time Difference</label>
            <div class="control has-icons-left has-icons-right">
              <input
                class="input has-output is-fullwidth"
                type="range"
                :min="minTimeDiffPercent"
                :max="maxTimeDiffPercent"
                step="0.1"
                id="maxTimeDifference"
                v-model.number="minTimeDifference"
                tooltip="always"
                tooltip-placement="bottom"
              />
              <span class="icon is-small is-left">
                <i class="fas fa-clock"></i>
              </span>
              <span class="icon is-small is-right">
                <output for="timeDifference">{{ minTimeDifference }}%</output>
              </span>
            </div>
          </div>
        </div>
        <div class="column is-full-mobile is-half-tablet">
          <div class="field">
            <!-- Max Time Difference -->
            <label class="label" for="timeDifference">Maximum Time Difference</label>
            <div class="control has-icons-left has-icons-right">
              <input
                class="input has-output is-fullwidth"
                type="range"
                :min="minTimeDiffPercent"
                :max="maxTimeDiffPercent"
                step="0.1"
                id="maxTimeDifference"
                v-model.number="maxTimeDifference"
                tooltip="always"
                tooltip-placement="bottom"
              />
              <span class="icon is-small is-left">
                <i class="fas fa-clock"></i>
              </span>
              <span class="icon is-small is-right">
                <output for="timeDifference">{{ maxTimeDifference }}%</output>
              </span>
            </div>
          </div>
        </div>
        <div class="column is-full-mobile is-half-tablet">
          <div class="field">
            <!-- Suggested Values -->
            <label class="label" for="suggestedValues">Suggested Values</label>
            <div class="control">
              <label class="checkbox">
                <input type="checkbox" v-model="setSuggestedValsChecked" />
                Set suggested
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section class="container mb-5">
    <div class="is-hidden" id="fp3-table" v-html="rawHTMLContent"></div>
    <div v-if="resultsStore.fetching" class="notification is-info">Loading results...</div>
    <template v-else>
      <div class="table-container">
        <table class="table is-bordered is-striped is-hoverable is-fullwidth">
          <thead>
            <tr>
              <th :class="colIsActive('Cla')" @click="toggleSort('Cla')">
                <span>Cla</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('Cla')]"
                      :style="!colIsActive('Cla') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
              <th :class="colIsActive('Driver')" @click="toggleSort('Driver')">
                <span>Driver</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('Driver')]"
                      :style="!colIsActive('Driver') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
              <th :class="colIsActive('Chassis')" @click="toggleSort('Chassis')">
                <span>Chassis</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('Chassis')]"
                      :style="!colIsActive('Chassis') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
              <th :class="colIsActive('Engine')" @click="toggleSort('Engine')">
                <span>Engine</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('Engine')]"
                      :style="!colIsActive('Engine') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
              <th :class="colIsActive('Laps')" @click="toggleSort('Laps')">
                <span>Laps</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('Laps')]"
                      :style="!colIsActive('Laps') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
              <th :class="colIsActive('Time')" @click="toggleSort('Time')">
                <span>Time</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('Time')]"
                      :style="!colIsActive('Time') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
              <th :class="colIsActive('Interval')" @click="toggleSort('Interval')">
                <span>Interval</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('Interval')]"
                      :style="!colIsActive('Interval') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
              <th :class="colIsActive('km/h')" @click="toggleSort('km/h')">
                <span>km/h</span>
                <span class="icon-text">
                  <span class="icon">
                    <i
                      :class="['fas', 'fa-fw', getChevronClass('km/h')]"
                      :style="!colIsActive('km/h') ? 'visibility: hidden;' : ''"
                    ></i>
                  </span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              :class="getRowClasses(result)"
              v-for="result in sortedAndFilteredResults"
              :key="result.Driver"
            >
              <td>{{ result.Cla }}</td>
              <td>{{ result.Driver }}</td>
              <td>{{ result.Chassis }}</td>
              <td>{{ result.Engine }}</td>
              <td>{{ result.Laps }}</td>
              <td>{{ result.Time }}</td>
              <td>{{ result.Interval }}</td>
              <td>{{ result['km/h'] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
  <section class="container">
    <button class="button is-primary" @click="getResults(true)">Check for new results</button>
  </section>
</template>

<style scoped>
.chassis--mercedes {
  background: linear-gradient(to right, var(--c-mercedes) 3rem, rgba(0, 210, 190, 0) 30%);
}

.chassis--ferrari {
  background: linear-gradient(to right, var(--c-ferrari) 3rem, rgba(220, 0, 0, 0) 30%);
}

.chassis--red-bull {
  background: linear-gradient(to right, var(--c-red-bull) 3rem, rgba(0, 26, 48, 0) 30%);
}

.chassis--mclaren {
  background: linear-gradient(to right, var(--c-mclaren) 3rem, rgba(255, 135, 0, 0) 30%);
}

.chassis--aston-martin {
  background: linear-gradient(to right, var(--c-aston-martin) 3rem, rgba(3, 122, 104, 0) 30%);
}

.chassis--alpine {
  background: linear-gradient(to right, var(--c-alpine) 3rem, rgba(33, 115, 184, 0) 30%);
}

.chassis--rb {
  background: linear-gradient(to right, var(--c-rb) 3rem, rgba(20, 52, 203, 0) 30%);
}

.chassis--williams {
  background: linear-gradient(to right, var(--c-williams) 3rem, rgba(255, 255, 255, 0) 30%);
}

.chassis--sauber {
  background: linear-gradient(to right, var(--c-sauber) 3rem, rgba(155, 0, 0, 0) 30%);
}

.chassis--haas {
  background: linear-gradient(to right, var(--c-haas) 3rem, rgba(240, 215, 135, 0) 30%);
}
</style>
