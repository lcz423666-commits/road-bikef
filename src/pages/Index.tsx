import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ChevronRight, RotateCcw, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type Tire = Tables<"tires">;

type WetPreference = "very" | "normal" | "not";
type WidthPreference = "28" | "wider";

interface TireWithScore extends Tire {
  score: number;
  wg: number;
  rr: number;
  explanation: string; // 用于存储AI生成的推荐理由
}

const WEIGHT_CONFIG: Record<WetPreference, { wg: number; rr: number }> = {
  very: { wg: 0.8, rr: 0.2 },
  normal: { wg: 0.6, rr: 0.4 },
  not: { wg: 0.35, rr: 0.65 },
};

function generateReason(tire: TireWithScore, wetPref: WetPreference): string {
  const wgStrong = tire.wg >= 75;
  const rrLow = tire.rr <= 12;

  if (wetPref === "very") {
    if (wgStrong) return "湿地安全感优先，抓地力表现优异，适合多雨路况骑行";
    return "湿地性能在可接受范围，综合表现较好";
  }
  if (wetPref === "not") {
    if (rrLow) return "效率与速度的最佳平衡，滚阻保持在低水平，适合竞速训练";
    return "综合性能均衡，滚阻与抓地力兼顾";
  }
  // normal
  if (wgStrong && rrLow) return "湿地安全感与效率兼顾，全能型选手，适合日常训练与长途";
  if (wgStrong) return "湿地抓地出色，安全性更强，滚阻保持在可接受范围";
  if (rrLow) return "滚阻表现优秀，骑行更省力，湿地性能在合理水平";
  return "综合性能均衡，湿地与效率表现稳定，适合日常通勤骑行";
}

export default function Index() {
  const [wetPref, setWetPref] = useState<WetPreference>("normal");
  const [widthPref, setWidthPref] = useState<WidthPreference>("28");
  const [results, setResults] = useState<TireWithScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (showResults && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showResults]);

  // 动态更新页面 SEO 信息
  useEffect(() => {
    if (showResults && results.length > 0) {
      const top1 = results[0];
      const title = `${top1.brand} ${top1.model} - 公路车轮胎推荐结果 | Iron Legs`;
      const description = `为你推荐：${results.map((t, i) => `${i + 1}. ${t.brand} ${t.model} ${t.width_spec_mm}mm`).join('；')}。基于湿地抓地和滚阻性能的专业评测数据。`;
      
      document.title = title;
      
      // 更新 meta description
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        metaDesc.setAttribute('content', description);
      }
      
      // 更新 OG tags
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogTitle) ogTitle.setAttribute('content', title);
      if (ogDesc) ogDesc.setAttribute('content', description);
    } else {
      // 重置为默认标题
      document.title = '公路车轮胎购买指南 - 基于测试数据的智能推荐工具 | Iron Legs';
    }
  }, [showResults, results]);

  const handleGenerate = async () => {
    setLoading(true);
    setFeedback(null);

    try {
      const { data, error } = await supabase.from("tires").select("*");

      if (error) throw error;

      // 过滤掉 wet_center/wet_edge 为空的行
      const validTires = (data || []).filter(
        (t) => t.wet_center != null && t.wet_edge != null && t.rr_high_w != null
      );

      // 计算分数
      const weights = WEIGHT_CONFIG[wetPref];
      const tiresWithScore: TireWithScore[] = validTires.map((t) => {
        const wg = Math.min(t.wet_center!, t.wet_edge!);
        const rr = t.rr_high_w!;
        const rrNorm = 30 - rr;
        const score = wg * weights.wg + rrNorm * weights.rr;
        return { ...t, score, wg, rr, explanation: '' };
      });

      // 按胎宽优先筛选
      const preferredWidths = widthPref === "28" ? [28] : [30, 32];

      // 分组：优先宽度 和 其他宽度
      const preferred = tiresWithScore.filter((t) =>
        preferredWidths.includes(t.width_spec_mm || 0)
      );
      const others = tiresWithScore.filter(
        (t) => !preferredWidths.includes(t.width_spec_mm || 0)
      );

      // 各自按分数排序
      preferred.sort((a, b) => b.score - a.score);
      others.sort((a, b) => b.score - a.score);

      // 合并取 Top3
      const top3: TireWithScore[] = [];
      let i = 0,
        j = 0;
      while (top3.length < 3) {
        if (i < preferred.length) {
          top3.push(preferred[i]);
          i++;
        } else if (j < others.length) {
          top3.push(others[j]);
          j++;
        } else {
          break;
        }
      }

      // 为每个推荐轮胎生成推荐理由
      const explainedTop3 = await Promise.all(
        top3.map(async (tire) => {
          const { data: explanation, error: explanationError } = await supabase.functions.invoke(
            'explain_tires',
            { 
              body: { 
                tire: { ...tire },
                wetPref 
              }
            }
          );

          if (explanationError) {
            console.error(`Error explaining tire ${tire.id}:`, explanationError);
            return { ...tire, explanation: generateReason(tire, wetPref) }; // Fallback
          }

          return { ...tire, explanation: explanation.explanation };
        })
      );

      setResults(explainedTop3);
      setShowResults(true);

      // 上报 GA 事件：生成推荐成功
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'generate_recommendation', {
          event_category: 'User Action',
          event_label: `Q1:${wetPref} | Q2:${widthPref}`,
          q1_wet_preference: wetPref,
          q2_width_preference: widthPref,
          results_count: top3.length,
          top1_brand: top3[0]?.brand,
          top1_model: top3[0]?.model,
        });
      }
    } catch (err) {
      console.error("Error fetching tires:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setShowResults(false);
    setResults([]);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleLogoClick = () => {
    if (showResults) {
      setShowResults(false);
      setResults([]);
      setFeedback(null);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFeedback = async (value: string) => {
    setFeedback(value);
    
    // 准备反馈数据
    const feedbackData = {
      helpfulness: value,
      q1_importance: wetPref,
      q2_width_pref: widthPref,
      top1: results[0] ? `${results[0].brand} ${results[0].model} ${results[0].width_spec_mm}mm` : null,
      top2: results[1] ? `${results[1].brand} ${results[1].model} ${results[1].width_spec_mm}mm` : null,
      top3: results[2] ? `${results[2].brand} ${results[2].model} ${results[2].width_spec_mm}mm` : null,
    };

    // 上报 GA 自定义事件
    if (typeof window !== 'undefined' && window.gtag) {
      const eventName = value === 'helpful' ? 'feedback_helpful' 
                      : value === 'neutral' ? 'feedback_ok' 
                      : 'feedback_not_helpful';
      
      window.gtag('event', eventName, {
        event_category: 'User Feedback',
        event_label: `Q1:${wetPref} | Q2:${widthPref}`,
        q1_wet_preference: wetPref,
        q2_width_preference: widthPref,
        top1_tire: feedbackData.top1,
        top2_tire: feedbackData.top2,
        top3_tire: feedbackData.top3,
      });
    }

    try {
      const { error } = await supabase.from("feedback").insert(feedbackData);
      
      if (error) throw error;
      
      toast({
        description: "感谢反馈",
        duration: 2000,
      });
    } catch (err) {
      console.error("Error submitting feedback:", err);
      toast({
        title: "提交失败",
        description: "提交失败请重试",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  const handleCopy = async (tire: TireWithScore) => {
    const tireName = `${tire.brand} ${tire.model} ${tire.width_spec_mm}mm`;
    
    try {
      // 尝试使用现代 Clipboard API
      await navigator.clipboard.writeText(tireName);
      setCopiedId(tire.id);
      toast({
        description: "已复制轮胎名称",
        duration: 2000,
      });
      setTimeout(() => setCopiedId(null), 2000);

      // 上报 GA 事件：复制轮胎名称
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'copy_tire_name', {
          event_category: 'User Action',
          event_label: tireName,
          tire_brand: tire.brand,
          tire_model: tire.model,
          tire_width: tire.width_spec_mm,
        });
      }
    } catch (err) {
      // 降级方案：使用传统方法
      try {
        const textArea = document.createElement("textarea");
        textArea.value = tireName;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          setCopiedId(tire.id);
          toast({
            description: "已复制轮胎名称",
            duration: 2000,
          });
          setTimeout(() => setCopiedId(null), 2000);

          // 上报 GA 事件：复制轮胎名称（降级方案）
          if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'copy_tire_name', {
              event_category: 'User Action',
              event_label: tireName,
              tire_brand: tire.brand,
              tire_model: tire.model,
              tire_width: tire.width_spec_mm,
              copy_method: 'fallback',
            });
          }
        } else {
          throw new Error("Copy failed");
        }
      } catch (fallbackErr) {
        // 如果所有方法都失败，显示轮胎名称供手动复制
        toast({
          title: "无法自动复制",
          description: tireName,
          duration: 4000,
        });
      }
    }
  };

  const wetOptions = [
    { value: "very", label: "非常在意" },
    { value: "normal", label: "一般" },
    { value: "not", label: "不在意" },
  ];

  const widthOptions = [
    { value: "28", label: "默认 28mm" },
    { value: "wider", label: "更宽（30/32）" },
  ];

  return (
    <div className="min-h-screen bg-[#f7f7f8]">
      {/* Header - 深色顶部条 */}
      <header className="bg-[#0b0f14] h-16 sticky top-0 z-50 shadow-md">
        <div className="container mx-auto px-4 h-full max-w-[860px] flex items-center justify-between">
          {/* Logo */}
          <button 
            onClick={handleLogoClick}
            className="flex items-center gap-3 transition-transform hover:scale-105 active:scale-95"
            aria-label="返回首页"
          >
            <div className="w-10 h-10 flex items-center justify-center">
              <img
                src="https://grazia-prod.oss-ap-southeast-1.aliyuncs.com/resources/uid_100003531/logo_transparent_5130.png"
                alt="Iron Legs"
                className="w-full h-full object-contain"
                crossOrigin="anonymous"
              />
            </div>
          </button>
          
          {/* 右侧按钮 */}
          {showResults && (
            <Button 
              onClick={handleReset}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg h-9 px-4"
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              重新选择
            </Button>
          )}
        </div>
      </header>

      {/* Hero 区 */}
      <section className="bg-gradient-to-b from-[#fafafa] to-[#f7f7f8] border-b py-12">
        <div className="container mx-auto px-4 max-w-[860px]">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-foreground tracking-tight leading-tight mb-3">
              公路车轮胎购买指南
            </h1>
            <p className="text-base text-muted-foreground font-normal">
              用公开测试数据，快速选出更适合你的轮胎
            </p>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-4 py-12 max-w-[860px]">
        {!showResults ? (
          /* 输入区域 */
          <Card className="shadow-sm border border-[#e5e7eb] rounded-2xl overflow-hidden bg-white">
            <div className="p-8 md:p-10 space-y-10">
              {/* Q1 */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-foreground">
                  Q1：你更在意湿地防滑性吗？
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {wetOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setWetPref(option.value as WetPreference)}
                      className={`px-5 py-4 rounded-xl font-semibold text-sm transition-all border-2 ${
                        wetPref === option.value
                          ? "bg-primary text-primary-foreground border-primary shadow-md"
                          : "bg-white text-foreground border-[#e5e7eb] hover:border-primary/40 hover:shadow-sm"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Q2 */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-foreground">
                  Q2：你希望胎宽偏好？
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {widthOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setWidthPref(option.value as WidthPreference)}
                      className={`px-5 py-4 rounded-xl font-semibold text-sm transition-all border-2 ${
                        widthPref === option.value
                          ? "bg-primary text-primary-foreground border-primary shadow-md"
                          : "bg-white text-foreground border-[#e5e7eb] hover:border-primary/40 hover:shadow-sm"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 生成按钮 */}
              <Button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full h-14 text-base font-bold rounded-xl shadow-md hover:shadow-lg transition-all"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    正在分析数据...
                  </>
                ) : (
                  <>
                    生成推荐
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </div>
          </Card>
        ) : (
          /* 结果区域 */
          <div ref={resultsRef} className="space-y-6 animate-in fade-in duration-500">
            <div>
              <h2 className="text-2xl font-extrabold text-foreground mb-2">
                为你推荐 Top 3 轮胎
              </h2>
              <p className="text-sm text-muted-foreground">
                基于测试数据与你的偏好计算
              </p>
            </div>

            {/* 轮胎卡片 */}
            <div className="space-y-5">
              {results.map((tire, index) => (
                <Card
                  key={tire.id}
                  className="shadow-sm border border-[#e5e7eb] rounded-2xl overflow-hidden bg-white hover:shadow-md transition-all duration-300"
                >
                  <div className="p-6 md:p-7">
                    <div className="flex items-start gap-5">
                      {/* 排名徽章 - 绿色实心 */}
                      <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary flex items-center justify-center shadow-sm">
                        <span className="text-white font-extrabold text-lg">
                          {index + 1}
                        </span>
                      </div>

                      <div className="flex-1 space-y-5 min-w-0">
                        {/* 标题行 */}
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-xl font-bold text-foreground leading-tight mb-2 break-all">
                              {tire.brand} {tire.model}
                            </h3>
                            <span className="inline-block px-3 py-1 bg-[#dcfce7] text-[#166534] text-xs font-bold rounded-full">
                              {tire.width_spec_mm}mm
                            </span>
                          </div>
                        </div>

                        {/* 性能指标 - 评测风格 */}
                        <div className="space-y-4">
                          {/* Wet Grip */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-foreground">
                                Wet Grip 湿地抓地
                              </span>
                              <span className="text-sm font-bold text-primary">
                                {tire.wg.toFixed(1)}
                              </span>
                            </div>
                            <div className="w-[60%]">
                              <div className="h-1.5 bg-[#e5e7eb] rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-primary rounded-full transition-all"
                                  style={{ width: `${(tire.wg / 100) * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* RR High */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-foreground">
                                RR High 滚阻
                              </span>
                              <span className="text-sm font-bold text-primary">
                                {tire.rr.toFixed(1)}W
                              </span>
                            </div>
                            <div className="w-[60%]">
                              <div className="h-1.5 bg-[#e5e7eb] rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-primary rounded-full transition-all"
                                  style={{ width: `${Math.max(0, ((30 - tire.rr) / 30) * 100)}%` }}
                                />
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              效率评级（滚阻越低越好）
                            </p>
                          </div>
                        </div>

                        {/* 适合原因 - AI生成 */}
                        <div className="bg-[#f9fafb] px-4 py-3 rounded-lg border border-[#e5e7eb]">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {tire.explanation}
                          </p>
                        </div>

                        {/* 底部信息条 - 电商风格 */}
                        <div className="flex items-center justify-between pt-3 border-t border-[#e5e7eb]">
                          <div className="flex items-baseline gap-2">
                            {tire.price && (
                              <span className="text-2xl font-extrabold text-primary">
                                ¥{tire.price}
                              </span>
                            )}
                            {tire.source_site && (
                              <span className="text-xs text-muted-foreground">
                                来源：{tire.source_site}
                              </span>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(tire)}
                            className="h-8 px-3 text-xs font-medium rounded-lg hover:bg-secondary"
                          >
                            {copiedId === tire.id ? (
                              <>
                                <Check className="mr-1.5 h-3.5 w-3.5 text-primary" />
                                已复制
                              </>
                            ) : (
                              <>
                                <Copy className="mr-1.5 h-3.5 w-3.5" />
                                复制名称
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}

              {results.length === 0 && (
                <Card className="shadow-sm border border-[#e5e7eb] rounded-2xl bg-white">
                  <div className="p-12 text-center text-muted-foreground">
                    暂无符合条件的轮胎数据
                  </div>
                </Card>
              )}
            </div>

            {/* 免责声明 */}
            <div className="mt-8 p-5 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-xs text-amber-900 leading-relaxed">
                <strong className="font-bold">免责声明：</strong>
                推荐基于公开测试数据与权重计算，仅供决策参考，实际体验受路况、胎压、轮圈内宽等影响。
              </p>
            </div>

            {/* 反馈模块 */}
            <Card className="shadow-sm border border-[#e5e7eb] rounded-2xl overflow-hidden bg-white mt-6">
              <div className="p-6 md:p-8">
                <h3 className="text-base font-bold text-foreground mb-4">
                  这次推荐对你有帮助吗？
                </h3>
                <div className="flex flex-col sm:flex-row items-stretch justify-center gap-3">
                  {[
                    { value: "helpful", label: "有帮助" },
                    { value: "neutral", label: "一般" },
                    { value: "not_helpful", label: "没帮助" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleFeedback(option.value)}
                      className={`px-5 py-3.5 rounded-xl font-semibold text-sm transition-all border-2 ${
                        feedback === option.value
                          ? "bg-primary text-primary-foreground border-primary shadow-md"
                          : "bg-white text-foreground border-[#e5e7eb] hover:border-primary/40 hover:shadow-sm"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {feedback && (
                  <p className="mt-4 text-sm text-primary font-medium bg-primary/5 px-4 py-3 rounded-lg">
                    感谢你的反馈！这将帮助我们改进推荐算法。
                  </p>
                )}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
