(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !window.gsap || !window.ScrollTrigger) return;

  window.gsap.registerPlugin(window.ScrollTrigger);

  var stack = document.querySelector("[data-card-stack]");
  var cards = stack ? Array.prototype.slice.call(stack.querySelectorAll("[data-stack-card]")) : [];
  if (stack && cards.length > 1 && window.matchMedia("(min-width: 861px)").matches) {
    cards.forEach(function (card, index) {
      if (index === cards.length - 1) return;
      window.ScrollTrigger.create({
        trigger: card,
        start: "top 13%",
        endTrigger: stack,
        end: "bottom bottom",
        pin: true,
        pinSpacing: false,
        invalidateOnRefresh: true
      });
      window.gsap.to(card, {
        scale: 0.94 + index * 0.015,
        filter: "brightness(0.72)",
        ease: "none",
        scrollTrigger: {
          trigger: cards[index + 1],
          start: "top 88%",
          end: "top 18%",
          scrub: true
        }
      });
    });
  }

  var reveal = document.querySelector("[data-word-reveal]");
  if (reveal) {
    var words = reveal.textContent.trim().split(/\s+/);
    reveal.textContent = "";
    words.forEach(function (word, index) {
      var span = document.createElement("span");
      span.className = "word-reveal";
      span.textContent = word + (index === words.length - 1 ? "" : " ");
      reveal.appendChild(span);
    });
    window.gsap.to(reveal.querySelectorAll(".word-reveal"), {
      opacity: 1,
      stagger: 0.08,
      ease: "none",
      scrollTrigger: {
        trigger: reveal,
        start: "top 82%",
        end: "bottom 36%",
        scrub: true
      }
    });
  }
})();
