-- LVC 시나리오 설계 도우미: Supabase 초기 설정
-- Supabase 대시보드 > SQL Editor에 이 파일 내용을 붙여 넣고 Run 한 번이면 된다. 여러 번 실행해도 안전하다.

-- 시나리오·의견·이력·카탈로그·사후검토 기록을 한 표에 컬렉션별로 저장
create table if not exists public.lvc_docs (
  col text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);

-- 시간당 요청 수 제한용 카운터
create table if not exists public.lvc_rate (
  key text primary key,
  n integer not null default 0,
  created_at timestamptz not null default now()
);

-- 행 수준 보안을 켜고 정책은 만들지 않는다.
-- 브라우저용 공개(anon) 키로는 아무것도 읽고 쓸 수 없고, 서버의 서비스 키만 접근한다.
alter table public.lvc_docs enable row level security;
alter table public.lvc_rate enable row level security;

create or replace function public.lvc_hit(p_key text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v integer;
begin
  delete from lvc_rate where created_at < now() - interval '2 hours';
  insert into lvc_rate (key, n) values (p_key, 1)
    on conflict (key) do update set n = lvc_rate.n + 1
    returning n into v;
  return v <= p_limit;
end;
$$;

revoke all on function public.lvc_hit(text, integer) from public, anon, authenticated;
grant execute on function public.lvc_hit(text, integer) to service_role;
