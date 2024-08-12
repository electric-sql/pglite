<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const positions = new Array(5).fill(0).map((_, i) => {
  return {
    a: -(i * 30 - 20),
    o: 1 - i * 0.15,
    s: 1 - i * 0.05,
  }
})

const heroImage = ref(null)

const handleMouseMove = (event) => {
  const { clientX, clientY } = event
  const width = window.innerWidth
  const height = window.innerHeight
  const rotateX = (clientY / height) * 5 - 10
  const rotateY = (clientX / width) * 5 - 35

  if (heroImage.value) {
    heroImage.value.style.transform = `translateZ(-100px) scale(1.2) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`
  }
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
})
</script>

<template>
  <div class="custom-hero-image-wrapper">
    <div ref="heroImage" class="custom-hero-image">
      <img src="/img/brand/icon-light.svg" class="main" />
      <div class="chain">
        <div
          class="baby"
          v-for="(pos, i) in positions"
          :key="i"
          :style="{
            transform: `rotateY(${pos.a}deg) scale(${pos.s})`,
            filter: `brightness(${pos.o})`,
          }"
        >
          <img src="/img/brand/icon-light.svg" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-hero-image-wrapper {
  position: relative;
  perspective: 1000px;
}
.custom-hero-image {
  position: relative;
  transform-style: preserve-3d;
  transform: translateZ(-100px) scale(1.2) rotateX(-10deg) rotateY(-35deg);
  transition: transform 0.1s ease-out;
}
.elephant-chain {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform: translateZ(50px);
}
.main {
  transform: translateZ(-50px) scale(1.1);
}
.chain {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}
.baby {
  position: absolute;
  bottom: 0;
  left: 20%;
  width: 45%;
  height: 45%;
  transform-origin: 0 0 -300px;
}
.baby img {
  transform: translate(-50%, 0);
  filter: drop-shadow(0 0 0 rgba(0, 0, 0, 0.5));
}

@media (max-width: 959px) {
  .custom-hero-image-wrapper {
    transform: scale(0.6);
  }
}
</style>
