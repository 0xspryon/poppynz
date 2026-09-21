// FAQ toggle for Plan 2 pages: an element with class faq-item contains a faq-question and a faq-answer.
(function () {
  document.addEventListener('click', function (e) {
    var q = e.target.closest('.faq-question');
    if (!q) return;
    var item = q.closest('.faq-item');
    if (!item) return;
    var list = item.parentElement;
    var open = item.classList.contains('is-open');
    if (list) list.querySelectorAll('.faq-item.is-open').forEach(function (i) { i.classList.remove('is-open'); });
    if (!open) item.classList.add('is-open');
  });
})();
