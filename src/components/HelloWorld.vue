<script setup lang="ts">
import { ref, onMounted } from 'vue'

const rawHTMLContent = ref('')
const localStorageKey = 'fetchedHTMLContent'

onMounted(async () => {
  const today = new Date()
  const isSaturday = today.getDay() === 6 // 6 is Saturday in getDay()

  let htmlContent = ''

  if (!isSaturday) {
    // Try to retrieve from localStorage
    const storedContent = localStorage.getItem(localStorageKey)
    if (storedContent) {
      htmlContent = storedContent
    }
  }

  if (htmlContent === '') {
    // If it's Saturday or localStorage is empty
    try {
      const response = await fetch(
        'http://localhost:3000/fetch-html?url=https://www.autosport.com/f1/results/'
      )
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      htmlContent = await response.text()
      // Store the fetched content in localStorage
      localStorage.setItem(localStorageKey, htmlContent)
    } catch (error) {
      console.error('Failed to fetch HTML content:', error)
      return
    }
  }

  // Process the HTML content
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlContent, 'text/html')

  doc.body.querySelectorAll('*').forEach((el) => {
    // Remove all attributes
    while (el.attributes.length > 0) {
      el.removeAttribute(el.attributes[0].name)
    }

    if (el.tagName === 'TABLE') {
      el.setAttribute('class', 'table is-striped is-narrow is-hoverable')
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

  const serializer = new XMLSerializer()
  rawHTMLContent.value = serializer.serializeToString(doc.body)
})
</script>

<template>
  <div v-html="rawHTMLContent" class="hello-world"></div>
</template>
