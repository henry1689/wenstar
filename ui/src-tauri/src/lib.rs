use serde::Serialize;
use rand::Rng;

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct NeuralNode {
    pub id: usize,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub energy: f32,
    pub group: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct NeuralConnection {
    pub source: usize,
    pub target: usize,
    pub strength: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct NeuralData {
    pub nodes: Vec<NeuralNode>,
    pub connections: Vec<NeuralConnection>,
    pub timestamp: u64,
}

// ---------------------------------------------------------------------------
// 命令: 生成模拟神经数据
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_mock_neural_data(count: Option<usize>) -> NeuralData {
    let count = count.unwrap_or(350).clamp(50, 1000);
    let mut rng = rand::thread_rng();
    let range = 12.0_f32;

    // 生成节点
    let nodes: Vec<NeuralNode> = (0..count)
        .map(|i| NeuralNode {
            id: i,
            x: rng.gen_range(-range..range),
            y: rng.gen_range(-range..range),
            z: rng.gen_range(-range..range),
            energy: rng.gen_range(0.3..1.0),
            group: rng.gen_range(0..5),
        })
        .collect();

    // 计算连接（距离阈值）
    let threshold = 5.5_f32;
    let mut connections = Vec::new();

    for i in 0..count {
        for j in (i + 1)..count {
            let dx = nodes[i].x - nodes[j].x;
            let dy = nodes[i].y - nodes[j].y;
            let dz = nodes[i].z - nodes[j].z;
            let dist = (dx * dx + dy * dy + dz * dz).sqrt();
            if dist < threshold {
                let strength = 1.0 - dist / threshold;
                connections.push(NeuralConnection {
                    source: i,
                    target: j,
                    strength,
                });
            }
        }
    }

    NeuralData {
        nodes,
        connections,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    }
}

// ---------------------------------------------------------------------------
// Tauri App 入口
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_mock_neural_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
