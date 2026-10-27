"use client";

import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { IconAlertTriangle, IconShieldCheck } from "@tabler/icons-react";

import { ShrikeMark } from "@/components/shrike-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const termsBodyRef = useRef<HTMLDivElement>(null);

  // 滚动到条款底部（含无需滚动即可完整展示的情况）方可点击「同意」。
  function handleTermsScroll() {
    const el = termsBodyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadToEnd(true);
  }

  useEffect(() => {
    if (!termsOpen) return;
    // 打开时重置，并处理内容本就不足一屏、无法触发滚动的场景。
    setReadToEnd(false);
    const el = termsBodyRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setReadToEnd(true);
  }, [termsOpen]);

  useEffect(() => {
    // 已登录直接进主界面（静态导出下无 middleware 代劳这层跳转）。
    const token = auth.getToken();
    if (token) {
      // localStorage 可能仍有凭据但 cookie 已丢失。先同步，再发起全新请求，
      // 避免服务端守卫或路由缓存把跳转送回仍处于 checking 状态的登录页。
      auth.setToken(token);
      window.location.replace("/function/tasks");
      return;
    }
    api
      .authStatus()
      .then(({ initialized }) => {
        if (!initialized) router.replace("/setup");
      })
      .catch(() => setError("无法连接到后端服务"))
      .finally(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) {
      setError("请先阅读并同意《使用须知》");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { token } = await api.login("SHRIKE", password);
      auth.setToken(token);
      window.location.replace("/function/tasks");
    } catch {
      setError("用户名或密码错误");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div role="status" className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        正在检查登录状态…
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <div className="flex flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <CardContent className="grid p-0 md:grid-cols-2">
              <form onSubmit={handleSubmit} className="p-6 md:p-8">
                <FieldGroup>
                  <div className="flex flex-col items-center gap-2 text-center">
                    <h1 className="text-2xl font-bold">欢迎回来</h1>
                    <p className="text-balance text-muted-foreground">登录 SHRIKE 自主渗透测试控制台</p>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="username">用户名</FieldLabel>
                    <Input id="username" value="SHRIKE" readOnly className="bg-muted/50" />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="password">密码</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入密码"
                      autoFocus
                      autoComplete="current-password"
                      required
                    />
                  </Field>

                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="agree-terms"
                      checked={agreed}
                      onCheckedChange={(v) => setAgreed(v === true)}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="agree-terms"
                      className="text-sm font-normal leading-relaxed text-muted-foreground"
                    >
                      我已阅读并同意
                      <button
                        type="button"
                        onClick={() => setTermsOpen(true)}
                        className="mx-0.5 font-medium text-primary underline-offset-4 hover:underline"
                      >
                        《使用须知》
                      </button>
                    </Label>
                  </div>

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  <Field>
                    <Button type="submit" disabled={loading || !password || !agreed} className="w-full">
                      {loading ? "登录中..." : "登录"}
                    </Button>
                  </Field>

                  <FieldDescription className="text-center">
                    忘记密码？在服务器上运行 <code className="font-mono text-xs">reset-password.sh</code> 重置
                  </FieldDescription>
                </FieldGroup>
              </form>

              {/* 右栏：不打图，排一段等宽日志。p6 的终端气质比 stock 图更贴，
                  而且任何分辨率下都是矢量。注意用显式 mono 栈——项目的 --font-mono
                  是空的，font-mono 会退回 sans，ASCII/对齐会散架。 */}
              <div
                className="relative hidden overflow-hidden border-l md:block"
                style={{ backgroundImage: "linear-gradient(155deg, #0a0a0c 0%, #16161c 45%, #07070a 100%)" }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -top-20 -right-10 size-64 rounded-full blur-3xl"
                  style={{ background: "radial-gradient(circle, rgba(255,255,255,0.10), transparent 65%)" }}
                />
                <div className="relative flex h-full flex-col justify-center gap-7 px-8 py-10">
                  <div className="flex items-center gap-2.5">
                    <ShrikeMark className="size-4 text-white/80" />
                    <span
                      className="text-[11px] tracking-[0.34em] text-white/55"
                      style={{ fontFamily: MONO }}
                    >
                      SHRIKE
                    </span>
                  </div>

                  <div className="space-y-1.5 text-[11px] leading-relaxed" style={{ fontFamily: MONO }}>
                    <p className="text-white/40">
                      <span className="text-emerald-400/80">[traffic]</span> proxy on 127.0.0.1:8788
                    </p>
                    <p className="text-white/40">
                      <span className="text-emerald-400/80">[config]</span> skills loaded · 3
                    </p>
                    <p className="text-white/40">
                      <span className="text-violet-400/80">[engine]</span> planner ready · workers=3
                    </p>
                    <p className="text-white/40">
                      <span className="text-violet-400/80">[agent]</span> task#1 recon → asset graph
                    </p>
                    <p className="text-white/40">
                      <span className="text-sky-400/80">[finding]</span> 0 critical · pending review
                    </p>
                    <p className="text-white/30">
                      waiting for operator
                      <span className="ml-1 inline-block h-3 w-[6px] animate-pulse bg-white/50 align-middle" />
                    </p>
                  </div>

                  <span
                    className="text-[10px] tracking-[0.2em] text-white/20 uppercase"
                    style={{ fontFamily: MONO }}
                  >
                    self-hosted · isolated lab only
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <FieldDescription className="px-6 text-center">
            SHRIKE 基于 AGPL-3.0 开源 · 仅限在自建的隔离环境内使用
          </FieldDescription>
        </div>
      </div>

      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="flex-row items-center gap-3 border-b px-6 py-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconShieldCheck className="size-5" />
            </div>
            <div className="space-y-0.5">
              <DialogTitle className="text-base">SHRIKE 使用须知与免责声明</DialogTitle>
              <p className="text-xs text-muted-foreground">
                版本 v1.0 · 生效日期 2026-09-18 · 请在登录前完整阅读以下全部条款
              </p>
            </div>
          </DialogHeader>

          <div
            ref={termsBodyRef}
            onScroll={handleTermsScroll}
            className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-muted-foreground"
          >
            <p className="rounded-lg border bg-muted/40 p-3 text-foreground/80">
              本《使用须知与免责声明》（以下简称"本声明"）是您与 SHRIKE
              项目作者及贡献者之间就使用本软件所达成的约定。请您在使用前审慎阅读、充分理解各条款内容，特别是以粗体或色块标注的免责、责任限制及禁止性条款。
              <span className="font-medium text-foreground">
                {" "}
                一旦您下载、安装、访问或以任何方式使用本软件，即视为您已阅读、理解并同意接受本声明的全部约束。
              </span>
            </p>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  1
                </span>
                第一条 · 定义与开源许可
              </h4>
              <p className="pl-7">
                本软件（SHRIKE）是一款基于 GNU Affero General Public License
                v3.0（AGPL-3.0）发布的开源程序。您可依据该协议自由使用、复制、修改和分发本软件；但任何衍生作品（包括通过网络向第三方提供的在线服务）均须同样以
                AGPL-3.0 协议开源并向使用者公开对应的完整源代码。AGPL-3.0 完整条款以随附的 LICENSE 文件为准。
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  2
                </span>
                第二条 · 授权使用范围
              </h4>
              <p className="pl-7">
                本软件仅供个人学习、代码研究、安全技术原理探讨，以及在您自行搭建的本地隔离环境中进行技术验证之用，适用于学习、学术研究、代码审阅等非攻击性、非破坏性用途。除本条明确许可的情形外，您不得将本软件用于任何其他目的。
              </p>
            </section>

            <section className="space-y-2">
              <h4 className="flex items-center gap-2 font-medium text-destructive">
                <span className="flex size-5 items-center justify-center rounded-md bg-destructive/10 text-xs font-semibold text-destructive">
                  3
                </span>
                <IconAlertTriangle className="size-4" />
                第三条 · 禁止行为
              </h4>
              <ul className="ml-7 list-decimal space-y-1.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3 pl-8 text-foreground/80 marker:text-destructive/70">
                <li>
                  严禁对任何网站、线上服务、他人或第三方所有的联网系统发起扫描、探测、利用或攻击（无论是否已获得授权、是否为您自有资产）；
                </li>
                <li>严禁将本软件用于任何实际的渗透测试、攻防对抗、红蓝演练或生产环境；</li>
                <li>严禁将本软件用于非法入侵、数据窃取、勒索、拒绝服务（DoS/DDoS）或任何破坏性、犯罪性活动；</li>
                <li>严禁移除、篡改或规避本软件及其输出中的任何版权、许可或安全提示信息；</li>
                <li>严禁从事任何违反您所在国家或地区法律、法规及监管规定的行为。</li>
              </ul>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  4
                </span>
                第四条 · 知识产权
              </h4>
              <p className="pl-7">
                本软件的著作权及相关知识产权归项目作者及贡献者所有，并在 AGPL-3.0
                协议约定的范围内向您授予相应权利。除该协议明确授予的权利外，本声明未以明示或默示方式授予您任何其他权利。
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  5
                </span>
                第五条 · 数据与隐私
              </h4>
              <p className="pl-7">
                本软件为可自行部署的开源程序，作者不运营任何集中式服务、亦不会收集或上传您的使用数据。您在使用过程中产生、处理或接触的一切数据，均由您自行掌控并负责其合法性与安全性；因数据处理不当引发的任何后果由您自行承担。
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  6
                </span>
                第六条 · 合规与法律责任
              </h4>
              <p className="pl-7">
                您应自行遵守所在国家或地区关于网络安全、数据安全与个人信息保护、计算机犯罪等方面的全部法律法规（在中国大陆包括但不限于《网络安全法》《数据安全法》《个人信息保护法》及相关司法解释）。
                <span className="font-medium text-foreground">
                  {" "}
                  因您违反上述法律法规或本声明约定而产生的一切法律责任与后果，均由您本人独立承担，与本软件作者及贡献者无关。
                </span>
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  7
                </span>
                第七条 · 免责声明与责任限制
              </h4>
              <p className="pl-7">
                本软件按"现状（AS IS）"与"现有（AS
                AVAILABLE）"状态提供，不附带任何明示或默示的担保，包括但不限于对适销性、特定用途适用性、准确性及不侵权的担保。在适用法律允许的最大范围内，本软件作者及贡献者不对因使用或无法使用本软件（无论使用方式是否得当）而导致的任何直接、间接、偶然、特殊或后果性损失承担责任，包括但不限于数据丢失、系统损坏、业务中断、利润损失或法律纠纷。
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                  8
                </span>
                第八条 · 条款变更与最终解释
              </h4>
              <p className="pl-7">
                作者有权根据法律法规或项目发展需要不时更新本声明，更新后的版本将随项目发布并自公布之日起生效；您继续使用本软件即视为接受修订后的条款。在法律允许的范围内，本声明的最终解释权归项目作者所有。若本声明任一条款被认定为无效，不影响其余条款的效力。
              </p>
            </section>
          </div>

          <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-2 rounded-b-xl px-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {readToEnd ? "您已浏览全部条款" : "请将条款滚动至底部后再确认"}
            </p>
            <DialogClose asChild>
              <Button
                type="button"
                disabled={!readToEnd}
                onClick={() => {
                  setAgreed(true);
                  setError("");
                }}
              >
                我已阅读并同意全部条款
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
