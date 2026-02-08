import React, { useState, useEffect } from 'react';

const CheenguExplainer = () => {
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  
  // Timeline of events (each with duration in ms)
  const timeline = [
    { type: 'title', duration: 3000 },
    { type: 'problem', duration: 4000 },
    { type: 'solution', duration: 3000 },
    { type: 'sms-intro', duration: 2000 },
    { type: 'sms-flow', duration: 12000 },
    { type: 'payment-screen', duration: 3000 },
    { type: 'judge-notification', duration: 3000 },
    { type: 'day-3-intro', duration: 2000 },
    { type: 'day-3-success', duration: 4000 },
    { type: 'day-5-intro', duration: 2000 },
    { type: 'day-5-fail', duration: 5000 },
    { type: 'week-end', duration: 3500 },
    { type: 'refund', duration: 4000 },
    { type: 'final-cta', duration: 5000 },
  ];
  
  useEffect(() => {
    if (!isPlaying) return;
    
    const currentEvent = timeline[step];
    if (!currentEvent) {
      setTimeout(() => setStep(0), 2000);
      return;
    }
    
    const timer = setTimeout(() => {
      setStep(s => s + 1);
    }, currentEvent.duration);
    
    return () => clearTimeout(timer);
  }, [step, isPlaying]);
  
  const Phone = ({ children, label }) => (
    <div style={{
      width: 260,
      height: 500,
      background: '#1a1a1a',
      borderRadius: 36,
      padding: 10,
      boxShadow: '0 25px 60px rgba(0,0,0,0.4), inset 0 0 0 2px #333',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 70,
        height: 22,
        background: '#000',
        borderRadius: 12,
        zIndex: 10,
      }} />
      <div style={{
        width: '100%',
        height: '100%',
        background: '#0f0f0f',
        borderRadius: 28,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          height: 40,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11,
          fontWeight: 600,
        }}>
          <span>9:41</span>
          <span style={{ display: 'flex', gap: 4 }}>📶 🔋</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </div>
      </div>
      {label && (
        <div style={{
          position: 'absolute',
          bottom: -36,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 13,
          fontWeight: 600,
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: 2,
        }}>
          {label}
        </div>
      )}
    </div>
  );
  
  const SMSHeader = ({ name }) => (
    <div style={{
      padding: '10px 14px',
      borderBottom: '1px solid #222',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 14,
      }}>
        {name[0]}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
        <div style={{ fontSize: 10, color: '#666' }}>SMS</div>
      </div>
    </div>
  );
  
  const Message = ({ text, sent, animate = true }) => (
    <div style={{
      display: 'flex',
      justifyContent: sent ? 'flex-end' : 'flex-start',
      padding: '3px 10px',
      animation: animate ? 'slideIn 0.3s ease-out' : 'none',
    }}>
      <div style={{
        maxWidth: '82%',
        padding: '8px 12px',
        borderRadius: sent ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: sent ? '#10b981' : '#2a2a2a',
        fontSize: 13,
        lineHeight: 1.4,
      }}>
        {text}
      </div>
    </div>
  );

  const renderContent = () => {
    // Title screen
    if (step === 0) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 20,
          animation: 'fadeIn 0.8s ease-out',
        }}>
          <div style={{
            fontSize: 64,
            fontWeight: 800,
            color: '#10b981',
            letterSpacing: -2,
          }}>
            Cheengu
          </div>
          <div style={{
            fontSize: 22,
            color: '#888',
            fontWeight: 500,
          }}>
            Accountability that actually works
          </div>
          <div style={{
            marginTop: 32,
            padding: '14px 28px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 600,
          }}>
            See how it works →
          </div>
        </div>
      );
    }
    
    // Problem screen
    if (step === 1) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: 40,
          gap: 28,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{ fontSize: 56 }}>😅</div>
          <div style={{
            fontSize: 26,
            fontWeight: 700,
            textAlign: 'center',
            lineHeight: 1.3,
          }}>
            "I'll start working out Monday..."
          </div>
          <div style={{
            fontSize: 17,
            color: '#666',
            textAlign: 'center',
          }}>
            Sound familiar? Promises to yourself are easy to break.
          </div>
        </div>
      );
    }
    
    // Solution screen
    if (step === 2) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: 40,
          gap: 28,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{ fontSize: 56 }}>💰</div>
          <div style={{
            fontSize: 26,
            fontWeight: 700,
            textAlign: 'center',
            lineHeight: 1.3,
          }}>
            Put your money where your mouth is
          </div>
          <div style={{
            fontSize: 17,
            color: '#666',
            textAlign: 'center',
            maxWidth: 380,
          }}>
            Stake real money. Get verified by a friend. Succeed or lose your stake.
          </div>
        </div>
      );
    }
    
    // SMS intro
    if (step === 3) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: 40,
          gap: 28,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{ fontSize: 56 }}>📱</div>
          <div style={{
            fontSize: 26,
            fontWeight: 700,
            textAlign: 'center',
          }}>
            All via SMS
          </div>
          <div style={{
            fontSize: 17,
            color: '#666',
            textAlign: 'center',
          }}>
            No app to download. Just text.
          </div>
        </div>
      );
    }
    
    // SMS conversation flow
    if (step === 4) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
        }}>
          <Phone label="You">
            <SMSHeader name="Cheengu" />
            <div style={{ padding: '6px 0', overflowY: 'auto', height: 'calc(100% - 52px)' }}>
              <Message text="I want to work out 4x this week" sent={true} />
              <Message text="Nice! How much do you want to stake? ($5-$500)" sent={false} />
              <Message text="$20" sent={true} />
              <Message text="$20 it is! 💪 Who's going to keep you honest?" sent={false} />
              <Message text="+1 555-123-4567 (Kai)" sent={true} />
              <Message text="🔗 Stake your $20: cheengu.com/pay/abc123" sent={false} />
            </div>
          </Phone>
        </div>
      );
    }

    // Payment screen
    if (step === 5) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 24,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{ fontSize: 48 }}>💳</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Payment Complete</div>
          <div style={{
            padding: '12px 24px',
            background: '#10b981',
            borderRadius: 8,
            fontWeight: 600,
            color: '#000',
          }}>
            $20 Staked ✓
          </div>
          <div style={{ fontSize: 14, color: '#666' }}>Your judge will be notified</div>
        </div>
      );
    }
    
    // Judge notification
    if (step === 6) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          gap: 40,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <Phone label="Judge (Kai)">
            <SMSHeader name="Cheengu" />
            <div style={{ padding: '6px 0' }}>
              <Message 
                text="Hey Kai! Your friend wants you to be their accountability judge for: 'Work out 4x this week'. Reply YES to accept." 
                sent={false} 
              />
              <Message text="YES" sent={true} />
              <Message text="You're in! You'll get a text each day to verify." sent={false} />
            </div>
          </Phone>
        </div>
      );
    }
    
    // Day 3 intro
    if (step === 7) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 20,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{ fontSize: 56 }}>📅</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>Day 3</div>
          <div style={{ fontSize: 18, color: '#10b981' }}>Workout completed! ✓</div>
        </div>
      );
    }
    
    // Day 3 success flow
    if (step === 8) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          gap: 32,
        }}>
          <Phone label="You">
            <SMSHeader name="Cheengu" />
            <div style={{ padding: '6px 0' }}>
              <Message text="Just finished my workout! 💪" sent={true} />
              <Message text="✅ Day 3 verified by Kai! Stake: $20" sent={false} />
            </div>
          </Phone>
          
          <div style={{ fontSize: 32 }}>↔</div>
          
          <Phone label="Judge (Kai)">
            <SMSHeader name="Cheengu" />
            <div style={{ padding: '6px 0' }}>
              <Message text="Did your friend complete their workout today?" sent={false} />
              <Message text="Yes" sent={true} />
              <Message text="✅ Verified! They're doing great." sent={false} />
            </div>
          </Phone>
        </div>
      );
    }
    
    // Day 5 intro - missed
    if (step === 9) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 20,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{ fontSize: 56 }}>📅</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>Day 5</div>
          <div style={{ fontSize: 18, color: '#ef4444' }}>Workout missed... 😬</div>
        </div>
      );
    }
    
    // Day 5 fail flow with deduction
    if (step === 10) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          gap: 32,
        }}>
          <Phone label="You">
            <SMSHeader name="Cheengu" />
            <div style={{ padding: '6px 0' }}>
              <Message text="❌ Day marked as FAIL. -$5" sent={false} />
              <Message text="Stake remaining: $15" sent={false} />
            </div>
          </Phone>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              fontSize: 48,
              fontWeight: 800,
              color: '#ef4444',
            }}>
              -$5
            </div>
            <div style={{ fontSize: 14, color: '#666' }}>Penalty deducted</div>
          </div>
          
          <Phone label="Judge (Kai)">
            <SMSHeader name="Cheengu" />
            <div style={{ padding: '6px 0' }}>
              <Message text="Did your friend complete their workout today?" sent={false} />
              <Message text="No" sent={true} />
              <Message text="Got it. Day marked as missed." sent={false} />
            </div>
          </Phone>
        </div>
      );
    }
    
    // Week end
    if (step === 11) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 20,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{ fontSize: 56 }}>🎯</div>
          <div style={{ fontSize: 32, fontWeight: 700, textAlign: 'center' }}>
            Week Complete!
          </div>
          <div style={{ fontSize: 18, color: '#888' }}>
            3/4 workouts completed
          </div>
          <div style={{
            marginTop: 8,
            padding: '8px 16px',
            background: '#1a1a1a',
            borderRadius: 8,
            fontSize: 14,
          }}>
            1 missed day = -$5 penalty
          </div>
        </div>
      );
    }
    
    // Refund screen
    if (step === 12) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 28,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{
            fontSize: 64,
            fontWeight: 800,
            color: '#10b981',
          }}>
            +$15
          </div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            Refunded to your card
          </div>
          <div style={{
            fontSize: 15,
            color: '#888',
            textAlign: 'center',
            maxWidth: 360,
          }}>
            You staked $20, missed 1 day (-$5), and got $15 back.
          </div>
        </div>
      );
    }
    
    // Final CTA
    if (step >= 13) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 28,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <div style={{
            fontSize: 56,
            fontWeight: 800,
            color: '#10b981',
          }}>
            Cheengu
          </div>
          <div style={{
            fontSize: 26,
            fontWeight: 600,
            textAlign: 'center',
          }}>
            Ready to commit?
          </div>
          <div style={{
            marginTop: 12,
            padding: '18px 40px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            borderRadius: 14,
            fontSize: 18,
            fontWeight: 700,
          }}>
            Get Started
          </div>
          <div style={{
            fontSize: 14,
            color: '#666',
            marginTop: 4,
          }}>
            Stakes from $5 • Any goal • Human verification
          </div>
        </div>
      );
    }
    
    return null;
  };
  
  return (
    <div 
      style={{
        width: '100%',
        height: '100vh',
        background: 'linear-gradient(180deg, #0a0a0a 0%, #111 100%)',
        color: '#fff',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Progress bar */}
      <div style={{
        height: 4,
        background: '#222',
        width: '100%',
      }}>
        <div style={{
          height: '100%',
          background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
          width: `${(step / (timeline.length - 1)) * 100}%`,
          transition: 'width 0.3s ease-out',
        }} />
      </div>
      
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {renderContent()}
      </div>
      
      {/* Controls */}
      <div style={{
        padding: 20,
        display: 'flex',
        justifyContent: 'center',
        gap: 12,
      }}>
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          style={{
            padding: '10px 20px',
            background: '#222',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={() => setStep(0)}
          style={{
            padding: '10px 20px',
            background: '#222',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ↺ Restart
        </button>
      </div>
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default CheenguExplainer;
