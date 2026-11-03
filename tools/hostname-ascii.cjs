// 컴퓨터 이름이 한글이면 Vercel CLI가 HTTP 헤더를 만들다 실패한다. CLI에만 ASCII 이름을 보여 준다.
const os = require("os");
const real = os.hostname();
os.hostname = () => (/^[\x20-\x7e]+$/.test(real) ? real : "lvc-pc");
