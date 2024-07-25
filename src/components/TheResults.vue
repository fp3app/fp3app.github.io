<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { nextTick } from 'vue'
import { useResultsStore } from '@/stores/results'

const resultsStore = useResultsStore()

const rawHTMLContent = ref('')
const headerText = ref('')
const localStorageKey = 'fetchedHTMLContent'
const sortState = ref({ column: 'Cla', isAscending: true })
const minLapsFilter = ref(0)
const isLapDiffFilterEnabled = ref(false)
const lapDiffThreshold = ref(0)
const lapDiffThresholdWeight = ref(5)

onMounted(async () => {
  getResults()
})

const getResults = async (reFetch?: false) => {
  resultsStore.fetching = true

  let htmlContent = ''
  let headerHtmlContent = '' // Added to store the headerHtml content

  // Try to retrieve from localStorage first
  const storedContent = localStorage.getItem(localStorageKey)
  if (storedContent && !reFetch) {
    htmlContent = storedContent
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
      // and we need the tableHtml part which is at index [1]
      htmlContent = data.tableHtml // Adjusted to access the tableHtml property
      headerHtmlContent = data.headerHtml // Assuming this is the headerHtml from the response
      console.log(`file: TheResults.vue:41 - getResults - headerHtmlContent:`, headerHtmlContent)

      // Store the fetched content in localStorage
      localStorage.setItem(localStorageKey, htmlContent)
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

const sortedAndFilteredResults = computed(() => {
  // Calculate the maximum laps to determine the threshold
  const maxLaps = Math.max(...resultsStore.results.data.map((result) => Number(result.Laps)))
  lapDiffThreshold.value = maxLaps / lapDiffThresholdWeight.value

  // Group by chassis
  const groupedByChassis = resultsStore.results.data.reduce<Record<string, DriverResult[]>>(
    (acc, result) => {
      if (!acc[result.Chassis]) acc[result.Chassis] = []
      acc[result.Chassis].push(result)
      return acc
    },
    {}
  )

  // Filter based on lap difference criteria if enabled
  const filteredByLapDifference = Object.values(groupedByChassis).reduce<DriverResult[]>(
    (acc, chassisResults) => {
      if (isLapDiffFilterEnabled.value) {
        // Determine if any lap difference within this chassis exceeds the threshold
        const exceedsThreshold = chassisResults.some((result, index, arr) => {
          if (index === 0) return false // No previous item to compare for the first item
          return (
            Math.abs(Number(result.Laps) - Number(arr[index - 1].Laps)) > lapDiffThreshold.value
          )
        })

        // If no lap differences exceed the threshold, include this chassis's results
        if (!exceedsThreshold) acc.push(...chassisResults)
      } else {
        // If filter is disabled, include all results
        acc.push(...chassisResults)
      }
      return acc
    },
    []
  )

  // Apply existing sorting and minimum laps filtering
  return filteredByLapDifference
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
  return sortState.value.column === column ? 'is-selected' : ''
}

function getChevronClass(column: string) {
  return sortState.value.column === column && sortState.value.isAscending === true
    ? 'fa-chevron-up'
    : 'fa-chevron-down'
}
</script>

<template>
  <section class="container mb-4">
    <h2 class="title is-3">{{ headerText }} (FP3)</h2>
  </section>
  <section class="container mb-4">
    <h2 class="subtitle is-4">Filters</h2>
    <nav class="panel">
      <p class="panel-heading">Filter Options</p>
      <div class="panel-block">
        <p class="control has-icons-left">
          <input
            class="input"
            type="number"
            placeholder="Minimum Laps"
            v-model.number="minLapsFilter"
          />
          <span class="icon is-small is-left">
            <i class="fas fa-tachometer-alt"></i>
          </span>
        </p>
      </div>
      <div class="panel-block">
        <div class="field">
          <label class="label" for="lapDiffThreshold">Lap Difference Threshold</label>
          <div class="control">
            <input
              class="slider has-output is-fullwidth"
              type="range"
              min="1"
              max="30"
              step="1"
              id="lapDiffThreshold"
              v-model="lapDiffThresholdWeight"
              tooltip="always"
              tooltip-placement="bottom"
            />
          </div>
          <output for="lapDiffThreshold">{{ lapDiffThreshold }}</output>
        </div>
        <label class="checkbox">
          <input type="checkbox" v-model="isLapDiffFilterEnabled" />
          Enable Max Lap Difference (Threshold: {{ lapDiffThreshold }})
        </label>
      </div>
      <div class="panel-block">
        <p class="control has-icons-left">
          <input class="input" type="text" placeholder="Time Difference" />
          <span class="icon is-small is-left">
            <i class="fas fa-clock"></i>
          </span>
        </p>
      </div>
    </nav>
  </section>
  <section class="container mb-5">
    <div class="is-hidden" id="fp3-table" v-html="rawHTMLContent"></div>
    <div v-if="resultsStore.fetching" class="notification is-info">Loading results...</div>
    <template v-else>
      <h2 class="subtitle is-4">Results</h2>
      <table class="table is-bordered">
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
